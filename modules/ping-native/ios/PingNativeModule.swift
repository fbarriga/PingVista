// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import ExpoModulesCore
import Darwin
import UIKit

// iOS allows unprivileged ICMP echo via SOCK_DGRAM sockets (no root, no
// entitlement). Unlike Linux, Darwin does NOT strip the IP header: an ICMPv4
// reply arrives as a whole IP packet, so the ICMP message starts after the
// IPv4 header. ICMPv6 replies carry no IP header and start at byte 0. Apple's
// SimplePing sample draws the same distinction.

struct IcmpPingOptions: Record {
  @Field var family: Int = 4
  @Field var packetSize: Int = 56
  @Field var ttl: Int = 60
  @Field var timeoutMs: Int = 2000
  @Field var seq: Int = 1
  @Field var requestId: String = ""
}

struct IcmpPingResult: Record {
  @Field var rttMs: Double = 0
}

struct InterfaceAddress: Record {
  @Field var ip: String = ""
  @Field var family: Int = 4
}

struct NetworkInterfaceInfo: Record {
  @Field var name: String = ""
  @Field var addresses: [InterfaceAddress] = []
}

struct DefaultGatewayInfo: Record {
  @Field var ip: String = ""
  @Field var family: Int = 4
  @Field var interfaceName: String = ""
}

struct PingError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

public class PingNativeModule: Module {
  private let networkQueue = DispatchQueue(
    label: "cl.felipebarriga.pingvista.network",
    qos: .userInitiated,
    attributes: .concurrent
  )
  private let activeSocketsLock = NSLock()
  private var activeIcmpSockets: [String: Int32] = [:]
  private var cancelledIcmpRequests: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("PingNative")

    // iOS has no public API for a Wi-Fi low-latency lock like Android's
    // WifiLock, so this only covers the keep-screen-on half of the
    // optimization; disabling the idle timer must happen on the main thread.
    AsyncFunction("beginLatencyOptimization") {
      DispatchQueue.main.async {
        UIApplication.shared.isIdleTimerDisabled = true
      }
    }

    AsyncFunction("endLatencyOptimization") {
      DispatchQueue.main.async {
        UIApplication.shared.isIdleTimerDisabled = false
      }
    }

    // Android-only feature (Wi-Fi radio keep-alive during a test). No iOS
    // equivalent hook exists, so these are no-ops kept only so the shared
    // PingNativeModule.ts interface is implemented symmetrically on both platforms.
    AsyncFunction("beginRouterKeepAlive") { (ip: String, family: Int, intervalMs: Int) in
    }

    AsyncFunction("endRouterKeepAlive") {
    }

    AsyncFunction("getNetworkInterfaces") { () -> [NetworkInterfaceInfo] in
      try readNetworkInterfaces()
    }.runOnQueue(networkQueue)

    AsyncFunction("getDefaultGateways") { () -> [DefaultGatewayInfo] in
      try readDefaultGateways()
    }.runOnQueue(networkQueue)

    AsyncFunction("resolveHost") { (host: String, family: Int) -> String in
      try resolveHost(host, family: family)
    }.runOnQueue(networkQueue)

    AsyncFunction("icmpPing") { (ip: String, options: IcmpPingOptions) -> IcmpPingResult in
      let rttMs = try sendIcmpEcho(
        ip: ip,
        options: options,
        onSocketOpen: { fd in self.registerIcmpSocket(fd, requestId: options.requestId) },
        onSocketClose: { fd in self.closeIcmpSocket(fd, requestId: options.requestId) }
      )
      var result = IcmpPingResult()
      result.rttMs = rttMs
      return result
    }.runOnQueue(networkQueue)

    AsyncFunction("cancelIcmpPing") { (requestId: String) in
      self.cancelIcmpSocket(requestId: requestId)
    }

    OnDestroy {
      self.cancelAllIcmpSockets()
      DispatchQueue.main.async {
        UIApplication.shared.isIdleTimerDisabled = false
      }
    }
  }

  private func registerIcmpSocket(_ fd: Int32, requestId: String) -> Bool {
    activeSocketsLock.lock()
    let wasCancelled = cancelledIcmpRequests.remove(requestId) != nil
    if !wasCancelled {
      activeIcmpSockets[requestId] = fd
    }
    activeSocketsLock.unlock()
    return !wasCancelled
  }

  private func closeIcmpSocket(_ fd: Int32, requestId: String) {
    activeSocketsLock.lock()
    if activeIcmpSockets[requestId] == fd {
      activeIcmpSockets.removeValue(forKey: requestId)
    }
    cancelledIcmpRequests.remove(requestId)
    close(fd)
    activeSocketsLock.unlock()
  }

  private func cancelIcmpSocket(requestId: String) {
    activeSocketsLock.lock()
    cancelledIcmpRequests.insert(requestId)
    let fd = activeIcmpSockets[requestId]
    if let fd {
      shutdown(fd, SHUT_RDWR)
    }
    activeSocketsLock.unlock()

    // A registered socket's own close() clears the marker. Only an unmatched
    // cancellation needs the sweep below: it may have arrived just before
    // registration (so the marker must survive to be observed there), or after
    // the request already finished natively, in which case nothing else would
    // ever remove it.
    guard fd == nil else { return }
    networkQueue.asyncAfter(deadline: .now() + .seconds(30)) { [weak self] in
      guard let self else { return }
      self.activeSocketsLock.lock()
      if self.activeIcmpSockets[requestId] == nil {
        self.cancelledIcmpRequests.remove(requestId)
      }
      self.activeSocketsLock.unlock()
    }
  }

  private func cancelAllIcmpSockets() {
    activeSocketsLock.lock()
    for fd in activeIcmpSockets.values {
      shutdown(fd, SHUT_RDWR)
    }
    activeSocketsLock.unlock()
  }
}

// The routing table can grow between the size query and the fetch (a VPN
// connecting, Wi-Fi/cellular churn), which fails the second sysctl call with
// ENOMEM. Retry a few times with a freshly queried size before giving up.
private func readRouteTable(mib: inout [Int32]) throws -> [UInt8] {
  let maxAttempts = 3
  for attempt in 1...maxAttempts {
    var size = 0
    guard sysctl(&mib, UInt32(mib.count), nil, &size, nil, 0) == 0 else {
      throw PingError(message: "Unable to read network routes")
    }
    guard size > 0 else {
      return []
    }

    var bytes = [UInt8](repeating: 0, count: size)
    if sysctl(&mib, UInt32(mib.count), &bytes, &size, nil, 0) == 0 {
      return bytes
    }
    if errno != ENOMEM || attempt == maxAttempts {
      throw PingError(message: "Unable to read network routes")
    }
  }
  throw PingError(message: "Unable to read network routes")
}

private func readDefaultGateways() throws -> [DefaultGatewayInfo] {
  // rt_msghdr has a fixed-width 92-byte layout on Darwin. The fields used
  // here are msglen@0, index@4, flags@8, and addrs@12.
  let routeHeaderLength = 92
  let routeFlagUp: Int32 = 0x1
  let routeFlagGateway: Int32 = 0x2
  let routeAddressDestination = 0
  let routeAddressGateway = 1
  let routeAddressCount = 8
  var mib = [CTL_NET, PF_ROUTE, 0, AF_UNSPEC, NET_RT_DUMP, 0]
  let bytes = try readRouteTable(mib: &mib)

  var candidatesByFamily: [Int: [DefaultGatewayInfo]] = [:]
  var messageOffset = 0
  while messageOffset + routeHeaderLength <= bytes.count {
    let messageLength = Int(readRouteValue(bytes, offset: messageOffset, as: UInt16.self))
    let interfaceIndex = readRouteValue(bytes, offset: messageOffset + 4, as: UInt16.self)
    let flags = readRouteValue(bytes, offset: messageOffset + 8, as: Int32.self)
    let addressMask = readRouteValue(bytes, offset: messageOffset + 12, as: Int32.self)
    guard messageLength >= routeHeaderLength,
          messageOffset + messageLength <= bytes.count else { break }

    let requiredFlags = routeFlagUp | routeFlagGateway
    if flags & requiredFlags == requiredFlags {
      var addressOffset = messageOffset + routeHeaderLength
      var destinationIsDefault = false
      var gatewayIp: String?
      var gatewayFamily: Int?

      for addressIndex in 0..<routeAddressCount {
        guard addressMask & (1 << addressIndex) != 0 else { continue }
        guard addressOffset + 2 <= messageOffset + messageLength else { break }
        let addressLength = max(Int(bytes[addressOffset]), MemoryLayout<UInt32>.size)
        guard addressOffset + addressLength <= messageOffset + messageLength else { break }

        if addressIndex == routeAddressDestination {
          destinationIsDefault = isDefaultRouteAddress(bytes, offset: addressOffset)
        } else if addressIndex == routeAddressGateway {
          let parsed = numericRouteAddress(bytes, offset: addressOffset)
          gatewayIp = parsed?.ip
          gatewayFamily = parsed?.family
        }

        addressOffset += (addressLength + MemoryLayout<UInt32>.size - 1)
          & ~(MemoryLayout<UInt32>.size - 1)
      }

      if destinationIsDefault, let ip = gatewayIp, let family = gatewayFamily {
        let interfaceName = nameForInterface(index: interfaceIndex)
        var scopedIp = ip
        if family == 6, isIPv6LinkLocal(ip), !interfaceName.isEmpty {
          scopedIp += "%\(interfaceName)"
        }

        var gateway = DefaultGatewayInfo()
        gateway.ip = scopedIp
        gateway.family = family
        gateway.interfaceName = interfaceName
        candidatesByFamily[family, default: []].append(gateway)
      }
    }

    messageOffset += messageLength
  }

  // A multi-homed device (Wi-Fi + cellular, or an active VPN) can have more
  // than one UP+GATEWAY default route per address family; prefer whichever
  // one is on the interface the OS would actually route through, falling
  // back to the first one seen if that can't be determined.
  return candidatesByFamily.keys.sorted().compactMap { family in
    let candidates = candidatesByFamily[family] ?? []
    guard candidates.count > 1, let preferredInterface = preferredInterfaceName(family: family == 6 ? AF_INET6 : AF_INET) else {
      return candidates.first
    }
    return candidates.first(where: { $0.interfaceName == preferredInterface }) ?? candidates.first
  }
}

// connect() on a UDP socket sends no packets — it only asks the kernel to
// pick a route for the given destination — so this is a safe, offline-safe
// way to read back which local interface the OS currently prefers.
private func preferredInterfaceName(family: Int32) -> String? {
  // let's use a public Google DNS server as the probe destination.
  let probeIp = family == AF_INET6 ? "2001:4860:4860::8888" : "8.8.8.8"
  guard let destAddr = sockaddrData(forIp: probeIp, family: family) else { return nil }

  let fd = socket(family, SOCK_DGRAM, 0)
  guard fd >= 0 else { return nil }
  defer { close(fd) }

  let connected = destAddr.withUnsafeBytes { destPtr -> Int32 in
    let sockaddrPtr = destPtr.bindMemory(to: sockaddr.self).baseAddress!
    return connect(fd, sockaddrPtr, socklen_t(destAddr.count))
  }
  guard connected == 0 else { return nil }

  var storage = sockaddr_storage()
  var len = socklen_t(MemoryLayout<sockaddr_storage>.size)
  let nameResult = withUnsafeMutablePointer(to: &storage) { storagePtr -> Int32 in
    storagePtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
      getsockname(fd, sockaddrPtr, &len)
    }
  }
  guard nameResult == 0 else { return nil }

  var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
  let status = withUnsafeMutablePointer(to: &storage) { storagePtr -> Int32 in
    storagePtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
      getnameinfo(sockaddrPtr, len, &hostBuffer, socklen_t(hostBuffer.count), nil, 0, NI_NUMERICHOST)
    }
  }
  guard status == 0 else { return nil }

  let localIp = String(cString: hostBuffer).split(separator: "%").first.map(String.init) ?? ""
  guard !localIp.isEmpty, let interfaces = try? readNetworkInterfaces() else { return nil }
  return interfaces.first(where: { iface in iface.addresses.contains(where: { $0.ip == localIp }) })?.name
}

private func isIPv6LinkLocal(_ ip: String) -> Bool {
  var address = in6_addr()
  guard ip.withCString({ inet_pton(AF_INET6, $0, &address) }) == 1 else { return false }
  return withUnsafeBytes(of: address) { bytes in
    bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80
  }
}

private func readRouteValue<T>(_ bytes: [UInt8], offset: Int, as type: T.Type) -> T {
  bytes.withUnsafeBytes {
    $0.loadUnaligned(fromByteOffset: offset, as: type)
  }
}

private func isDefaultRouteAddress(_ bytes: [UInt8], offset: Int) -> Bool {
  let family = Int32(bytes[offset + 1])
  if family == AF_INET, offset + MemoryLayout<sockaddr_in>.size <= bytes.count {
    let address = bytes.withUnsafeBytes {
      $0.loadUnaligned(fromByteOffset: offset, as: sockaddr_in.self)
    }
    return address.sin_addr.s_addr == 0
  }
  if family == AF_INET6, offset + MemoryLayout<sockaddr_in6>.size <= bytes.count {
    let address = bytes.withUnsafeBytes {
      $0.loadUnaligned(fromByteOffset: offset, as: sockaddr_in6.self)
    }
    return withUnsafeBytes(of: address.sin6_addr) { raw in
      raw.allSatisfy { $0 == 0 }
    }
  }
  return false
}

private func numericRouteAddress(_ bytes: [UInt8], offset: Int) -> (ip: String, family: Int)? {
  let family = Int32(bytes[offset + 1])
  var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))

  if family == AF_INET, offset + MemoryLayout<sockaddr_in>.size <= bytes.count {
    var address = bytes.withUnsafeBytes {
      $0.loadUnaligned(fromByteOffset: offset, as: sockaddr_in.self).sin_addr
    }
    guard inet_ntop(AF_INET, &address, &buffer, socklen_t(buffer.count)) != nil else { return nil }
    return (String(cString: buffer), 4)
  }
  if family == AF_INET6, offset + MemoryLayout<sockaddr_in6>.size <= bytes.count {
    var address = bytes.withUnsafeBytes {
      $0.loadUnaligned(fromByteOffset: offset, as: sockaddr_in6.self).sin6_addr
    }
    guard inet_ntop(AF_INET6, &address, &buffer, socklen_t(buffer.count)) != nil else { return nil }
    return (String(cString: buffer), 6)
  }
  return nil
}

private func nameForInterface(index: UInt16) -> String {
  guard index != 0 else { return "" }
  var buffer = [CChar](repeating: 0, count: Int(IF_NAMESIZE))
  guard if_indextoname(UInt32(index), &buffer) != nil else { return "" }
  return String(cString: buffer)
}

private func readNetworkInterfaces() throws -> [NetworkInterfaceInfo] {
  var addressesByName: [String: [InterfaceAddress]] = [:]
  var orderedNames: [String] = []

  var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&ifaddrPtr) == 0, let firstAddr = ifaddrPtr else {
    throw PingError(message: "Unable to read network interfaces")
  }
  defer { freeifaddrs(ifaddrPtr) }

  var current: UnsafeMutablePointer<ifaddrs>? = firstAddr
  while let entry = current {
    defer { current = entry.pointee.ifa_next }

    let flags = entry.pointee.ifa_flags
    guard flags & UInt32(IFF_UP) != 0, flags & UInt32(IFF_LOOPBACK) == 0 else { continue }
    guard let sockaddrPtr = entry.pointee.ifa_addr else { continue }
    let family = sockaddrPtr.pointee.sa_family
    guard family == sa_family_t(AF_INET) || family == sa_family_t(AF_INET6) else { continue }

    var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    let status = getnameinfo(
      sockaddrPtr, socklen_t(sockaddrPtr.pointee.sa_len),
      &hostBuffer, socklen_t(hostBuffer.count),
      nil, 0, NI_NUMERICHOST
    )
    guard status == 0 else { continue }

    // Link-local IPv6 addresses come back as "fe80::1%en0"; drop the scope suffix.
    let ip = String(cString: hostBuffer).split(separator: "%").first.map(String.init) ?? ""
    let name = String(cString: entry.pointee.ifa_name)

    var address = InterfaceAddress()
    address.ip = ip
    address.family = family == sa_family_t(AF_INET) ? 4 : 6

    if addressesByName[name] == nil {
      orderedNames.append(name)
    }
    addressesByName[name, default: []].append(address)
  }

  return orderedNames.map { name in
    var info = NetworkInterfaceInfo()
    info.name = name
    info.addresses = addressesByName[name] ?? []
    return info
  }
}

private func resolveHost(_ host: String, family: Int) throws -> String {
  var hints = addrinfo()
  hints.ai_family = family == 6 ? AF_INET6 : AF_INET
  hints.ai_socktype = SOCK_DGRAM

  var resultPtr: UnsafeMutablePointer<addrinfo>?
  let status = getaddrinfo(host, nil, &hints, &resultPtr)
  guard status == 0, let info = resultPtr else {
    throw PingError(message: "Could not resolve \(host)")
  }
  defer { freeaddrinfo(resultPtr) }

  var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
  let nameStatus = getnameinfo(
    info.pointee.ai_addr, info.pointee.ai_addrlen,
    &hostBuffer, socklen_t(hostBuffer.count),
    nil, 0, NI_NUMERICHOST
  )
  guard nameStatus == 0 else {
    throw PingError(message: "Could not resolve \(host)")
  }
  return String(cString: hostBuffer)
}

private func sendIcmpEcho(
  ip: String,
  options: IcmpPingOptions,
  onSocketOpen: (Int32) -> Bool,
  onSocketClose: (Int32) -> Void
) throws -> Double {
  // These bounds must match MIN/MAX_PACKET_SIZE and MIN/MAX_TTL in
  // src/constants.ts, which is the source of truth the UI validates against.
  // The check is repeated here because the native module is callable directly.
  guard options.packetSize >= 0 && options.packetSize <= 1_400 else {
    throw PingError(message: "Packet size must be between 0 and 1400 bytes")
  }
  guard options.ttl >= 1 && options.ttl <= 255 else {
    throw PingError(message: "TTL must be between 1 and 255")
  }
  guard options.timeoutMs > 0 else {
    throw PingError(message: "Timeout must be greater than zero")
  }
  guard !options.requestId.isEmpty else {
    throw PingError(message: "Request ID must not be empty")
  }
  guard options.family == 4 || options.family == 6 else {
    throw PingError(message: "family must be 4 or 6")
  }

  let family: Int32 = options.family == 6 ? AF_INET6 : AF_INET
  let proto: Int32 = options.family == 6 ? IPPROTO_ICMPV6 : IPPROTO_ICMP

  let fd = socket(family, SOCK_DGRAM, proto)
  guard fd >= 0 else {
    throw PingError(message: "Could not open ICMP socket")
  }
  var socketIsRegistered = false
  defer {
    if socketIsRegistered {
      onSocketClose(fd)
    } else {
      close(fd)
    }
  }

  var ttlValue = Int32(options.ttl)
  let ttlResult: Int32
  if options.family == 6 {
    ttlResult = setsockopt(fd, IPPROTO_IPV6, IPV6_UNICAST_HOPS, &ttlValue, socklen_t(MemoryLayout<Int32>.size))
  } else {
    ttlResult = setsockopt(fd, IPPROTO_IP, IP_TTL, &ttlValue, socklen_t(MemoryLayout<Int32>.size))
  }
  guard ttlResult == 0 else { throw PingError(message: "Could not set TTL") }

  guard let destAddr = sockaddrData(forIp: ip, family: family) else {
    throw PingError(message: "Invalid IP address: \(ip)")
  }

  // Connecting the socket restricts the kernel to delivering datagrams from
  // this destination only, so a stray or spoofed reply from another host
  // can't be mistaken for ours. Once connected, send()/recv() (rather than
  // sendto()/recvfrom()) are the unambiguous way to use the socket.
  let connectResult = destAddr.withUnsafeBytes { destPtr -> Int32 in
    let sockaddrPtr = destPtr.bindMemory(to: sockaddr.self).baseAddress!
    return connect(fd, sockaddrPtr, socklen_t(destAddr.count))
  }
  guard connectResult == 0 else {
    throw PingError(message: "Could not connect ICMP socket")
  }

  // Register only after connect(). Cancellation that arrived during socket
  // setup is now observed before send(), while later shutdown() calls operate
  // on a connected socket and reliably interrupt recv().
  guard onSocketOpen(fd) else {
    throw PingError(message: "Ping cancelled")
  }
  socketIsRegistered = true

  // Darwin keeps the identifier written here, but it does not demultiplex
  // replies by it: every ICMP socket connected to this peer is handed every
  // reply the peer sends. Replies are therefore matched on message type and
  // sequence, and the receive loop below skips the ones belonging to other
  // in-flight requests. JS drives the loop and passes the sequence number so
  // the on-wire seq matches the one shown in the UI.
  let packet = buildIcmpPacket(family: options.family, identifier: UInt16(getpid() & 0xFFFF), sequence: UInt16(truncatingIfNeeded: options.seq), payloadSize: max(0, options.packetSize))

  let start = DispatchTime.now()

  let sent = packet.withUnsafeBytes { packetPtr in
    send(fd, packetPtr.baseAddress, packet.count, 0)
  }
  guard sent == packet.count else {
    throw PingError(message: "Failed to send ping")
  }

  // SO_RCVTIMEO bounds a single recv() call, not this whole loop, so a
  // stray non-matching packet arriving before the real reply would
  // otherwise reset the wait on every iteration. Track a deadline instead
  // and shrink the socket timeout to match on each pass.
  let deadline = DispatchTime.now() + .milliseconds(options.timeoutMs)
  var buffer = [UInt8](repeating: 0, count: 2048)
  while true {
    let remainingMs = remainingMilliseconds(until: deadline)
    guard remainingMs > 0 else {
      throw PingError(message: "Request timed out")
    }
    var timeout = timeval(tv_sec: remainingMs / 1000, tv_usec: Int32((remainingMs % 1000) * 1000))
    guard setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0 else {
      throw PingError(message: "Could not set ICMP timeout")
    }

    let received = recv(fd, &buffer, buffer.count, 0)
    if received == 0 {
      throw PingError(message: "Ping cancelled")
    }
    if received < 0 {
      if errno == EAGAIN || errno == EWOULDBLOCK {
        throw PingError(message: "Request timed out")
      }
      // A signal-interrupted receive is not a failure; the loop re-checks the
      // deadline and waits again.
      if errno == EINTR {
        continue
      }
      throw PingError(message: "Failed to receive ping reply")
    }
    let reply = Array(buffer[0..<received])
    if isEchoReply(reply, family: options.family, sequence: UInt16(truncatingIfNeeded: options.seq)) {
      break
    }
    // Not our reply (stray packet on the same socket) — keep waiting until the deadline.
  }

  let end = DispatchTime.now()
  return Double(end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
}

private func remainingMilliseconds(until deadline: DispatchTime) -> Int {
  let now = DispatchTime.now()
  guard deadline > now else { return 0 }
  return Int((deadline.uptimeNanoseconds - now.uptimeNanoseconds) / 1_000_000)
}

private func buildIcmpPacket(family: Int, identifier: UInt16, sequence: UInt16, payloadSize: Int) -> [UInt8] {
  var packet = [UInt8](repeating: 0, count: 8 + payloadSize)
  packet[0] = family == 6 ? 128 : 8 // echo request: 128 (ICMPv6) or 8 (ICMPv4)
  packet[1] = 0 // code
  packet[2] = 0 // checksum (filled below for v4; kernel fills it for v6)
  packet[3] = 0
  packet[4] = UInt8(identifier >> 8)
  packet[5] = UInt8(identifier & 0xFF)
  packet[6] = UInt8(sequence >> 8)
  packet[7] = UInt8(sequence & 0xFF)
  for i in 0..<payloadSize {
    packet[8 + i] = UInt8(i & 0xFF)
  }

  if family != 6 {
    let sum = internetChecksum(packet)
    packet[2] = UInt8(sum >> 8)
    packet[3] = UInt8(sum & 0xFF)
  }

  return packet
}

private func internetChecksum(_ bytes: [UInt8]) -> UInt16 {
  var sum: UInt32 = 0
  var i = 0
  while i + 1 < bytes.count {
    sum += (UInt32(bytes[i]) << 8) | UInt32(bytes[i + 1])
    i += 2
  }
  if i < bytes.count {
    sum += UInt32(bytes[i]) << 8
  }
  while sum >> 16 != 0 {
    sum = (sum & 0xFFFF) + (sum >> 16)
  }
  return ~UInt16(sum & 0xFFFF)
}

// Offset of the ICMP message inside a received datagram. ICMPv6 arrives bare;
// ICMPv4 arrives wrapped in its IP packet, whose header length is the low
// nibble of the first byte counted in 32-bit words.
private func icmpMessageOffset(_ data: [UInt8], family: Int) -> Int? {
  if family == 6 {
    return 0
  }
  guard let firstByte = data.first, firstByte >> 4 == 4 else { return nil }
  let headerLength = Int(firstByte & 0x0F) * 4
  guard headerLength >= 20, data.count >= headerLength else { return nil }
  return headerLength
}

private func isEchoReply(_ data: [UInt8], family: Int, sequence: UInt16) -> Bool {
  guard let offset = icmpMessageOffset(data, family: family), data.count >= offset + 8 else {
    return false
  }
  let expectedType: UInt8 = family == 6 ? 129 : 0
  let replySequence = (UInt16(data[offset + 6]) << 8) | UInt16(data[offset + 7])
  return data[offset] == expectedType && replySequence == sequence
}

private func sockaddrData(forIp ip: String, family: Int32) -> Data? {
  if family == AF_INET {
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    guard ip.withCString({ inet_pton(AF_INET, $0, &addr.sin_addr) }) == 1 else { return nil }
    return withUnsafeBytes(of: &addr) { Data($0) }
  } else {
    var addr = sockaddr_in6()
    addr.sin6_family = sa_family_t(AF_INET6)
    addr.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
    let parts = ip.split(separator: "%", maxSplits: 1).map(String.init)
    let address = parts[0]
    guard address.withCString({ inet_pton(AF_INET6, $0, &addr.sin6_addr) }) == 1 else { return nil }
    if parts.count == 2 {
      let interfaceIndex = if_nametoindex(parts[1])
      guard interfaceIndex != 0 else { return nil }
      addr.sin6_scope_id = interfaceIndex
    }
    return withUnsafeBytes(of: &addr) { Data($0) }
  }
}
