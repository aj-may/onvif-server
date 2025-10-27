const tcpProxy = require('node-tcp-proxy');
const onvifServer = require('./src/onvif-server');
const discoveryServer = require('./src/discovery-server');
const configBuilder = require('./src/config-builder');
const package = require('./package.json');
const argparse = require('argparse');
const readline = require('readline');
const stream = require('stream');
const yaml = require('yaml');
const fs = require('fs');
const util = require('util');

// Polyfill for util.isDate (removed in Node.js 18+)
if (!util.isDate) {
    util.isDate = function(d) {
        return d instanceof Date;
    };
}

const simpleLogger = require('simple-node-logger');

const parser = new argparse.ArgumentParser({
    description: 'Virtual Onvif Server'
});

parser.add_argument('-v', '--version', { action: 'store_true', help: 'show the version information' });
parser.add_argument('-cc', '--create-config', { action: 'store_true', help: 'create a new config' });
parser.add_argument('-d', '--debug', { action: 'store_true', help: 'show onvif requests' });
parser.add_argument('config', { help: 'config filename to use', nargs: '?'});

let args = parser.parse_args();

if (args) {
    const logger = simpleLogger.createSimpleLogger();
    if (args.debug)
        logger.setLevel('trace');

    if (args.version) {
        logger.info('Version: ' + package.version);
        return;
    }

    if (args.create_config) {
        let mutableStdout = new stream.Writable({
            write: function(chunk, encoding, callback) {
                if (!this.muted || chunk.toString().includes('\n'))
                    process.stdout.write(chunk, encoding);
                callback();
            }
        });

        const rl = readline.createInterface({
            input: process.stdin,
            output: mutableStdout,
            terminal: true
        });

        mutableStdout.muted = false;
        rl.question('Onvif Server: ', (hostname) => {
            rl.question('Onvif Username: ', (username) => {
                mutableStdout.muted = true;
                process.stdout.write('Onvif Password: ');
                rl.question('', (password) => {
                    console.log('Generating config ...');
                    configBuilder.createConfig(hostname, username, password).then((config) => {
                        if (config) {
                            console.log('# ==================== CONFIG START ====================');
                            console.log(yaml.stringify(config));
                            console.log('# ===================== CONFIG END =====================');
                        } else
                        console.log('Failed to create config!');
                    });
                    rl.close();
                });
            });
        });

    } else if (args.config) {
        let configData;
        try {
            configData = fs.readFileSync(args.config, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.error('File not found: ' + args.config);
                return -1;
            }
            throw error;
        }

        let config;
        try {
            config = yaml.parse(configData);
        } catch (error) {
            logger.error('Failed to read config, invalid yaml syntax.')
            return -1;
        }

        let proxies = {};
        let servers = [];
        const useDirectUrls = config.useDirectUrls || false;

        if (useDirectUrls) {
            logger.info('Direct URLs enabled - proxies will be bypassed');
            logger.info('');
        }

        for (let onvifConfig of config.onvif) {
            let server = onvifServer.createServer(onvifConfig, logger, useDirectUrls);
            if (server.getHostname()) {
                logger.info(`Starting virtual onvif server for ${onvifConfig.name} on ${onvifConfig.mac} ${server.getHostname()}:${onvifConfig.ports.server} ...`);
                server.startServer();
                if (args.debug)
                    server.enableDebugOutput();
                logger.info('  Started!');
                logger.info('');

                servers.push(server);

                // Only set up proxies if not using direct URLs
                if (!useDirectUrls) {
                    if (!proxies[onvifConfig.target.hostname])
                        proxies[onvifConfig.target.hostname] = {}

                    if (onvifConfig.ports.rtsp && onvifConfig.target.ports.rtsp)
                        proxies[onvifConfig.target.hostname][onvifConfig.ports.rtsp] = {
                            port: onvifConfig.target.ports.rtsp,
                            hostname: server.getHostname()
                        };
                    if (onvifConfig.ports.snapshot && onvifConfig.target.ports.snapshot)
                        proxies[onvifConfig.target.hostname][onvifConfig.ports.snapshot] = {
                            port: onvifConfig.target.ports.snapshot,
                            hostname: server.getHostname()
                        };
                }
            } else {
                logger.error(`Failed to find IP address for MAC address ${onvifConfig.mac}`)
                return -1;
            }
        }

        // Start centralized discovery server for all virtual devices
        if (servers.length > 0) {
            logger.info('Starting WS-Discovery server for all virtual devices ...');
            const discovery = discoveryServer.createDiscoveryServer(servers, logger);
            discovery.start();
            logger.info('  Started!');
            logger.info('');
        }
        
        for (let destinationAddress in proxies) {
            for (let sourcePort in proxies[destinationAddress]) {
                const proxyInfo = proxies[destinationAddress][sourcePort];
                logger.info(`Starting tcp proxy from ${proxyInfo.hostname}:${sourcePort} to ${destinationAddress}:${proxyInfo.port} ...`);
                tcpProxy.createProxy(sourcePort, destinationAddress, proxyInfo.port, {
                    hostname: proxyInfo.hostname
                });
                logger.info('  Started!');
                logger.info('');
            }
        }

    } else {
        logger.error('Please specifiy a config filename!');
        return -1;
    }

    return 0;
}
