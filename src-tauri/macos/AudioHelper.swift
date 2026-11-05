import AppKit
import ScreenCaptureKit
import CoreMedia
import AVFoundation
import Darwin

// Private to the app. stdout is JSON for queries or framed stereo Float32 PCM
// for capture: UInt32 process ID, UInt32 byte count, then little-endian samples.
// No screenshots, screen frames, audio files or account data are retained.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
func json(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { fail("原生响应格式无效") }
    FileHandle.standardOutput.write(data)
}
func players() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.compactMap { app in
        guard let bundle = app.bundleIdentifier else { return nil }
        let value = bundle.lowercased()
        let id: String
        if value.contains("qqmusic") { id = "qqmusic" }
        else if value.contains("netease") && (value.contains("music") || value.contains("163")) { id = "netease" }
        else if value.contains("kugou") { id = "kugou" }
        else if value.contains("kuwo") { id = "kuwo" }
        else if value.contains("soda") || value.contains("luna") && value.contains("music") { id = "soda" }
        else { return nil }
        return ["pid": Int(app.processIdentifier), "bundle": bundle, "player": id, "name": app.localizedName ?? bundle]
    }
}
func metadata(_ bundle: String) {
    // Public scripting dictionaries only. Unsupported players return an explicit
    // error rather than borrowed metadata or an invented playback timeline.
    let script = """
    function run(args) {
      var p = Application(args[0]);
      if (!p.running()) throw Error('播放器未运行');
      var t = p.currentTrack();
      return JSON.stringify({title:String(t.name()).slice(0,200), artist:String(t.artist()).slice(0,200), album:String(t.album()).slice(0,200),
        position:Number(p.playerPosition()), duration:Number(t.duration()), playing:String(p.playerState()) === 'playing'});
    }
    """
    let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-l", "JavaScript", "-e", script, bundle]
    let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.standardError
    do { try process.run() } catch { fail(error.localizedDescription) }
    DispatchQueue.global().asyncAfter(deadline: .now() + 6) {
        if process.isRunning { process.terminate() }
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0,
          var value = (try? JSONSerialization.jsonObject(with: pipe.fileHandleForReading.readDataToEndOfFile())) as? [String: Any] else { exit(1) }
    if bundle.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil {
        let source = "tell application id \"\(bundle)\" to get data of artwork 1 of current track"
        var error: NSDictionary?
        if let result = NSAppleScript(source: source)?.executeAndReturnError(&error), error == nil,
           result.data.count <= 5 * 1024 * 1024,
           let image = NSImage(data: result.data), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
           let bytes = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.75]),
           bytes.count <= 2 * 1024 * 1024 {
            value["cover"] = "data:image/jpeg;base64," + bytes.base64EncodedString()
        }
    }
    json(value)
}

@available(macOS 13.0, *)
final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    let pid: UInt32
    static let writer = DispatchQueue(label: "com.soundspectra.audio.writer")
    init(pid: UInt32) { self.pid = pid }
    func stream(_ stream: SCStream, didStopWithError error: Error) { fail(error.localizedDescription) }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription,
              let format = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
              format.mFormatID == kAudioFormatLinearPCM,
              format.mSampleRate == 48000,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              format.mBitsPerChannel == 32 else { return }
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0, frames <= 48000 else { return }
        var size = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: &size,
            bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: 0, blockBufferOut: nil)
        guard size > 0 else { return }
        let memory = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 16)
        defer { memory.deallocate() }
        let list = memory.bindMemory(to: AudioBufferList.self, capacity: 1)
        var retained: CMBlockBuffer?
        let result = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil,
            bufferListOut: list, bufferListSize: size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: &retained)
        guard result == noErr else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(list)
        let planar = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
        let channels = Int(format.mChannelsPerFrame)
        guard channels > 0, !buffers.isEmpty else { return }
        var pcm = Data(count: frames * 8)
        pcm.withUnsafeMutableBytes { (output: UnsafeMutableRawBufferPointer) in
            let target = output.bindMemory(to: Float.self)
            for frame in 0..<frames {
                for channel in 0..<2 {
                    let c = min(channel, channels - 1), bufferIndex = planar ? c : 0
                    guard bufferIndex < buffers.count, let data = buffers[bufferIndex].mData else { continue }
                    let offset = planar ? frame : frame * channels + c
                    if (offset + 1) * 4 <= Int(buffers[bufferIndex].mDataByteSize) {
                        target[frame * 2 + channel] = data.assumingMemoryBound(to: Float.self)[offset]
                    }
                }
            }
        }
        var id = pid.littleEndian, count = UInt32(pcm.count).littleEndian
        var packet = Data(bytes: &id, count: 4); packet.append(Data(bytes: &count, count: 4)); packet.append(pcm)
        Self.writer.sync { FileHandle.standardOutput.write(packet) }
    }
}

let args = CommandLine.arguments
guard args.count > 1 else { fail("缺少原生命令") }
switch args[1] {
case "list": json(players())
case "metadata":
    guard args.count == 3, players().contains(where: { $0["bundle"] as? String == args[2] }) else { fail("播放器不存在") }
    metadata(args[2])
case "wallpaper":
    guard let screen = NSScreen.main, let url = NSWorkspace.shared.desktopImageURL(for: screen) else { fail("无法读取当前桌面壁纸") }
    json(["path": url.path])
case "image":
    guard args.count == 3, let image = NSImage(contentsOfFile: args[2]),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let data = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { fail("无法读取壁纸图像") }
    json(["image": "data:image/jpeg;base64," + data.base64EncodedString()])
case "capture":
    guard #available(macOS 13.0, *), args.count == 3 else { fail("音频捕获要求 macOS 13 或更新版本") }
    let ids = Set(args[2].split(separator: ",").compactMap { UInt32($0) })
    let parent = getppid()
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else { fail("找不到显示器") }
            var streams: [SCStream] = [], outputs: [AudioOutput] = []
            for app in content.applications where ids.contains(UInt32(app.processID)) {
                let output = AudioOutput(pid: UInt32(app.processID))
                let config = SCStreamConfiguration()
                config.width = 2; config.height = 2; config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                config.showsCursor = false; config.capturesAudio = true; config.excludesCurrentProcessAudio = true
                config.sampleRate = 48000; config.channelCount = 2; config.queueDepth = 3
                let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
                let stream = SCStream(filter: filter, configuration: config, delegate: output)
                try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "com.soundspectra.audio.\(app.processID)"))
                try await stream.startCapture(); streams.append(stream); outputs.append(output)
            }
            guard !streams.isEmpty else { fail("所选播放器尚未运行") }
            // Keep delegates and streams alive until the owning Rust process kills this child.
            while true {
                try await Task.sleep(nanoseconds: 1_000_000_000)
                if getppid() != parent { exit(0) }
                withExtendedLifetime((streams, outputs)) {}
            }
        } catch { fail("请在系统设置的隐私与安全性中允许 SoundSpectra 录制屏幕与系统音频：\(error.localizedDescription)") }
    }
    RunLoop.main.run()
default: fail("未知原生命令")
}
