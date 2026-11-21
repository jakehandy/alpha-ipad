import CoreMIDI
import Foundation

/// Thin CoreMIDI wrapper: lists endpoints, sends raw bytes, and reassembles
/// incoming messages (including SysEx split across packets) per source.
final class MIDIBridge {
    struct Endpoint { let id: String; let name: String }

    var onPortsChanged: (() -> Void)?
    var onMessage: ((String, [UInt8]) -> Void)?

    private var client = MIDIClientRef()
    private var outPort = MIDIPortRef()
    private var inPort = MIDIPortRef()
    private var connected: [MIDIEndpointRef] = []
    private var parsers: [Int32: Parser] = [:]
    private let lock = NSLock()

    init() {
        MIDIClientCreateWithBlock("AlphaPad" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async {
                self?.connectSources()
                self?.onPortsChanged?()
            }
        }
        MIDIOutputPortCreate(client, "AlphaPad Out" as CFString, &outPort)
        MIDIInputPortCreateWithBlock(client, "AlphaPad In" as CFString, &inPort) { [weak self] list, refCon in
            let uid = Int32(truncatingIfNeeded: Int(bitPattern: refCon) & 0xFFFF_FFFF)
            self?.receive(list, from: uid)
        }
        connectSources()
    }

    func sources() -> [Endpoint] {
        (0..<MIDIGetNumberOfSources()).map { endpoint(MIDIGetSource($0)) }
    }

    func destinations() -> [Endpoint] {
        (0..<MIDIGetNumberOfDestinations()).map { endpoint(MIDIGetDestination($0)) }
    }

    func send(_ bytes: [UInt8], to id: String) {
        guard !bytes.isEmpty, let uid = Int32(id) else { return }
        var object = MIDIObjectRef()
        var type = MIDIObjectType.other
        guard MIDIObjectFindByUniqueID(uid, &object, &type) == noErr, type == .destination else { return }

        let size = MemoryLayout<MIDIPacketList>.size + bytes.count + 64
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: MIDIPacketList.self, capacity: 1)
        let packet = MIDIPacketListInit(list)
        bytes.withUnsafeBufferPointer { buf in
            _ = MIDIPacketListAdd(list, size, packet, 0, bytes.count, buf.baseAddress!)
        }
        MIDISend(outPort, MIDIEndpointRef(object), list)
    }

    private func endpoint(_ ref: MIDIEndpointRef) -> Endpoint {
        var uid: Int32 = 0
        MIDIObjectGetIntegerProperty(ref, kMIDIPropertyUniqueID, &uid)
        var name: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(ref, kMIDIPropertyDisplayName, &name)
        let text = (name?.takeRetainedValue() as String?) ?? "MIDI \(uid)"
        return Endpoint(id: String(uid), name: text)
    }

    private func connectSources() {
        for src in connected { MIDIPortDisconnectSource(inPort, src) }
        connected.removeAll()
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            var uid: Int32 = 0
            MIDIObjectGetIntegerProperty(src, kMIDIPropertyUniqueID, &uid)
            // Tag each source with its unique id so the callback knows where bytes came from.
            let tag = UnsafeMutableRawPointer(bitPattern: Int(UInt32(bitPattern: uid)) | 0x1_0000_0000)
            if MIDIPortConnectSource(inPort, src, tag) == noErr { connected.append(src) }
        }
    }

    private func receive(_ list: UnsafePointer<MIDIPacketList>, from uid: Int32) {
        lock.lock()
        let parser = parsers[uid] ?? Parser()
        parsers[uid] = parser
        var messages: [[UInt8]] = []
        for packet in list.unsafeSequence() {
            let length = Int(packet.pointee.length)
            let offset = MemoryLayout<MIDIPacket>.offset(of: \MIDIPacket.data)!
            let base = UnsafeRawPointer(packet).advanced(by: offset).assumingMemoryBound(to: UInt8.self)
            for i in 0..<length { if let m = parser.feed(base[i]) { messages.append(m) } }
        }
        lock.unlock()
        let source = String(uid)
        for m in messages { onMessage?(source, m) }
    }

    /// Byte-stream MIDI parser with running status and SysEx reassembly.
    final class Parser {
        private var sysex: [UInt8]?
        private var status: UInt8 = 0
        private var data: [UInt8] = []

        func feed(_ b: UInt8) -> [UInt8]? {
            if b >= 0xF8 { return [b] }                       // realtime, can appear anywhere
            if b == 0xF0 { sysex = [b]; return nil }
            if b == 0xF7 {
                guard var s = sysex else { return nil }
                s.append(b); sysex = nil; return s
            }
            if var s = sysex {
                if b < 0x80 { s.append(b); sysex = s; return nil }
                sysex = nil                                    // status byte aborts SysEx
            }
            if b >= 0x80 { status = b; data = []; return needed(b) == 0 ? [b] : nil }
            guard status != 0 else { return nil }
            data.append(b)
            if data.count == needed(status) {
                let m = [status] + data
                data = []
                if status >= 0xF0 { status = 0 }              // system common has no running status
                return m
            }
            return nil
        }

        private func needed(_ s: UInt8) -> Int {
            switch s & 0xF0 {
            case 0xC0, 0xD0: return 1
            case 0xF0:
                switch s { case 0xF1, 0xF3: return 1; case 0xF2: return 2; default: return 0 }
            default: return 2
            }
        }
    }
}
