const dgram = require('dgram');
const xml2js = require('xml2js');
const uuid = require('node-uuid');

class DiscoveryServer {
    constructor(servers, logger) {
        this.servers = servers;
        this.logger = logger;
        this.socket = null;
        this.responseSocket = null; // Reusable socket for sending responses
        this.messageCounters = new Map(); // Track message number per device

        // Initialize message counters for each device
        servers.forEach(server => {
            const info = server.getDiscoveryInfo();
            this.messageCounters.set(info.uuid, 0);
        });
    }

    start() {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.responseSocket = dgram.createSocket('udp4'); // Create reusable response socket

        this.socket.on('message', (message, remote) => {
            xml2js.parseString(message.toString(), { tagNameProcessors: [xml2js['processors'].stripPrefix] }, (err, result) => {
                if (err) {
                    this.logger.trace('Failed to parse discovery message:', err);
                    return;
                }

                let probeUuid = result['Envelope']['Header'][0]['MessageID'][0];
                let probeType = '';
                try {
                    probeType = result['Envelope']['Body'][0]['Probe'][0]['Types'][0];
                } catch (err) {
                    probeType = '';
                }

                if (typeof probeType === 'object')
                    probeType = probeType._;

                if (typeof probeUuid === 'object')
                    probeUuid = probeUuid._;

                // Only respond to probes for NetworkVideoTransmitter or generic probes
                if (probeType === '' || probeType.indexOf('NetworkVideoTransmitter') > -1) {
                    this.logger.trace(`Discovery probe received from ${remote.address}:${remote.port}`);

                    // Send a ProbeMatch response for each registered device
                    this.servers.forEach(server => {
                        const info = server.getDiscoveryInfo();
                        const messageNo = this.messageCounters.get(info.uuid);

                        const response =
                           `<?xml version="1.0" encoding="UTF-8"?>
                            <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
                                <SOAP-ENV:Header>
                                    <wsa:MessageID>uuid:${uuid.v1()}</wsa:MessageID>
                                    <wsa:RelatesTo>${probeUuid}</wsa:RelatesTo>
                                    <wsa:To SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
                                    <wsa:Action SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
                                    <d:AppSequence SOAP-ENV:mustUnderstand="true" MessageNumber="${messageNo}" InstanceId="1234567890"/>
                                </SOAP-ENV:Header>
                                <SOAP-ENV:Body>
                                    <d:ProbeMatches>
                                        <d:ProbeMatch>
                                            <wsa:EndpointReference>
                                                <wsa:Address>urn:uuid:${info.uuid}</wsa:Address>
                                            </wsa:EndpointReference>
                                            <d:Types>dn:NetworkVideoTransmitter</d:Types>
                                            <d:Scopes>
                                                onvif://www.onvif.org/type/video_encoder
                                                onvif://www.onvif.org/type/ptz
                                                onvif://www.onvif.org/hardware/Onvif
                                                onvif://www.onvif.org/name/Cardinal
                                                onvif://www.onvif.org/location/
                                            </d:Scopes>
                                            <d:XAddrs>http://${info.hostname}:${info.port}/onvif/device_service</d:XAddrs>
                                            <d:MetadataVersion>1</d:MetadataVersion>
                                        </d:ProbeMatch>
                                    </d:ProbeMatches>
                                </SOAP-ENV:Body>
                            </SOAP-ENV:Envelope>`;

                        // Increment message counter for this device
                        this.messageCounters.set(info.uuid, messageNo + 1);

                        const responseBuffer = Buffer.from(response);
                        this.responseSocket.send(responseBuffer, 0, responseBuffer.length, remote.port, remote.address);
                    });
                }
            });
        });

        this.socket.on('error', (err) => {
            this.logger.error('Discovery server error:', err);
        });

        // Bind to the WS-Discovery multicast port
        this.socket.bind(3702, () => {
            this.logger.trace('Discovery server bound to port 3702');

            // Join the multicast group for each server's hostname
            const hostnames = new Set();
            this.servers.forEach(server => {
                const info = server.getDiscoveryInfo();
                if (info.hostname) {
                    hostnames.add(info.hostname);
                }
            });

            hostnames.forEach(hostname => {
                try {
                    this.socket.addMembership('239.255.255.250', hostname);
                    this.logger.trace(`Joined multicast group on ${hostname}`);
                } catch (err) {
                    this.logger.error(`Failed to join multicast group on ${hostname}:`, err);
                }
            });
        });
    }

    stop() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        if (this.responseSocket) {
            this.responseSocket.close();
            this.responseSocket = null;
        }
    }
}

function createDiscoveryServer(servers, logger) {
    return new DiscoveryServer(servers, logger);
}

exports.createDiscoveryServer = createDiscoveryServer;
