# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Virtual Onvif Server that creates virtual Onvif Profile S devices from existing RTSP streams. Originally developed to work around Unifi Protect limitations with multi-channel cameras by splitting them into separate virtual devices, each with its own MAC address.

## Key Commands

### Installation
```bash
npm install
```

### Running the Server
```bash
# Start with a config file
node main.js ./config.yaml

# Create a new config by connecting to an existing Onvif device
node main.js --create-config

# Enable debug mode to see Onvif requests
node main.js -d ./config.yaml

# Show version
node main.js -v
```

### Docker
```bash
# Run with config
docker run --rm -it -v /path/to/config.yaml:/onvif.yaml ghcr.io/daniela-hase/onvif-server:latest

# Create config inside container
docker run --rm -it --entrypoint /bin/sh ghcr.io/daniela-hase/onvif-server:latest
node main.js --create-config
```

## Architecture

### Core Components

**main.js** - Entry point that:
- Parses command-line arguments (argparse)
- Loads and validates YAML config
- Creates OnvifServer instances for each camera
- Starts TCP proxies to forward RTSP/snapshot traffic from virtual interfaces to target devices

**src/onvif-server.js** - OnvifServer class that:
- Implements Onvif Profile S (live streaming) via SOAP services
- Binds to specific MAC addresses by resolving them to IP addresses via `getIpAddressFromMac()`
- Exposes two Onvif services:
  - DeviceService (device_service.wsdl) - device info, capabilities, date/time
  - MediaService (media_service.wsdl) - profiles, streams, snapshots
- Handles WS-Discovery on UDP multicast (239.255.255.250:3702) to announce devices
- Serves a default snapshot.png when no snapshot URL is configured
- Creates MainStream (high quality) and SubStream (low quality) profiles

**src/config-builder.js** - Config generator that:
- Connects to real Onvif devices via SOAP
- Discovers all profiles and streams
- Automatically determines high/low quality streams by comparing quality/resolution
- Generates YAML config template with placeholder MAC addresses

### Network Architecture

Each virtual Onvif device requires:
- Unique MAC address (via MacVLAN interfaces on Linux)
- Dedicated server port (default: 8081, 8082, ...)
- RTSP proxy port (default: 8554)
- Snapshot proxy port (default: 8580)

TCP proxies forward traffic from the virtual interface ports to the real device's ports.

### Configuration Structure

Each camera config has:
- `mac` - Virtual network interface MAC address
- `ports` - server (Onvif), rtsp, snapshot ports
- `name` - Display name
- `uuid` - Unique device identifier (UUIDv4)
- `highQuality/lowQuality` - Stream config with:
  - `rtsp` - RTSP path for the stream
  - `snapshot` - Snapshot URL path (optional)
  - `width`, `height` - Resolution in pixels
  - `framerate` - Frame rate in fps
  - `bitrate` - Bitrate in kbps
  - `quality` - Quality level (1.0-5.0)
  - `encoding` - Video codec (optional, defaults to 'H264'). Supported: 'H264', 'H265', 'MPEG4', 'JPEG'
  - `govLength` - GOP (Group of Pictures) length in frames (optional, defaults to framerate value)
  - `profile` - Codec profile (optional, defaults to 'Main' for H264). Examples: 'Baseline', 'Main', 'High'
  - `encodingInterval` - Frame encoding interval (optional, defaults to 1, meaning every frame is encoded)
- `target` - Real device hostname and ports

**Note on encoding parameters**: These optional parameters allow you to accurately describe the actual stream encoding. If omitted, reasonable defaults are used. Most VMS clients will detect actual stream parameters from RTSP negotiation even if ONVIF metadata doesn't match exactly.

### Onvif Profile S Implementation

The server implements a minimal Onvif Profile S (streaming) with:
- Video encoding support: H.264, H.265/HEVC (vendor extension), MPEG-4, MJPEG
- Configurable codec profiles (Baseline/Main/High for H.264)
- RTP-RTSP-TCP transport
- GetSystemDateAndTime (handles timezones and DST)
- GetCapabilities (Device, Media)
- GetServices
- GetDeviceInformation (identifies as "Onvif Cardinal")
- GetProfiles (MainStream/SubStream)
- GetVideoSources
- GetStreamUri (returns rtsp:// URL)
- GetSnapshotUri (returns http:// URL)

WS-Discovery responds to Probe messages for NetworkVideoTransmitter devices.

**H.265 Support**: While Profile S officially only supports H.264, this implementation allows H.265 as a vendor extension (similar to what Hikvision, Dahua, and others implemented before Profile T existed). VMS compatibility varies - test with your specific VMS.

## Important Implementation Details

- MAC address resolution happens via `os.networkInterfaces()` - the server must run on a system with the configured MAC address
- All Onvif communication uses SOAP 1.2 (forceSoap12Headers)
- Logger uses simple-node-logger with trace level for debug mode
- config-builder has retry logic for WSSE time check failures by adjusting UTC hours
- Device identifies as manufacturer "Onvif", model "Cardinal" for Unifi Protect compatibility
- probeUuid parsing handles both string and object types (fix for issue #15)

## Dependencies

Core: soap (1.1.5), node-tcp-proxy (0.0.28), xml2js (0.4.23)
Config: yaml (2.5.1), argparse (2.0.1)
Utils: node-uuid (1.4.8), simple-node-logger (^21.8.12)

## File Locations

- `/wsdl/` - Onvif WSDL definitions for device and media services
- `/resources/snapshot.png` - Default snapshot image when no snapshot URL configured
- `/config.yaml` - User configuration (not in repo, created by user)
