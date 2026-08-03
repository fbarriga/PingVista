// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

package expo.modules.pingnative

import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructTimeval
import android.util.Log
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.FileDescriptor
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.UnknownHostException
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Android allows unprivileged ICMP echo via SOCK_DGRAM sockets (the default
// kernel config opens net.ipv4.ping_group_range to all apps). Connecting the
// socket to the destination lets us use plain read()/write() instead of
// juggling sockaddr structs for sendto()/recvfrom().

class IcmpPingOptions : Record {
  @Field val family: Int = 4
  @Field val packetSize: Int = 56
  @Field val ttl: Int = 60
  @Field val timeoutMs: Int = 2000
  @Field val seq: Int = 1
  @Field val requestId: String = ""
}

class IcmpPingResult(
  @Field val rttMs: Double = 0.0
) : Record

class InterfaceAddressInfo(
  @Field val ip: String = "",
  @Field val family: Int = 4
) : Record

class NetworkInterfaceInfo(
  @Field val name: String = "",
  @Field val addresses: List<InterfaceAddressInfo> = emptyList()
) : Record

class DefaultGatewayInfo(
  @Field val ip: String = "",
  @Field val family: Int = 4,
  @Field val interfaceName: String = ""
) : Record

class PingException(message: String) : Exception(message)

private const val TAG = "PingNativeModule"

class PingNativeModule : Module() {
  private var latencyWifiLock: WifiManager.WifiLock? = null
  private var routerKeepAliveThread: Thread? = null
  @Volatile private var routerKeepAliveRunning = false
  private val icmpSocketLock = Any()
  private val activeIcmpSockets = ConcurrentHashMap<String, FileDescriptor>()
  private val cancelledIcmpRequests = ConcurrentHashMap.newKeySet<String>()
  // A single reusable Handler so OnDestroy can cancel every pending cleanup
  // Runnable at once; each Runnable's closure otherwise holds this module
  // instance alive until it fires, up to 30s after the module is destroyed.
  private val cleanupHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("PingNative")

    AsyncFunction("beginLatencyOptimization") {
      enableLatencyOptimization()
    }

    AsyncFunction("endLatencyOptimization") {
      disableLatencyOptimization()
    }

    AsyncFunction("beginRouterKeepAlive") { ip: String, family: Int, intervalMs: Int ->
      beginRouterKeepAlive(ip, family, intervalMs)
    }

    AsyncFunction("endRouterKeepAlive") {
      endRouterKeepAlive()
    }

    AsyncFunction("getNetworkInterfaces") {
      readNetworkInterfaces()
    }.runOnQueue(appContext.backgroundCoroutineScope)

    AsyncFunction("getDefaultGateways") {
      readDefaultGateways(appContext.reactContext)
    }.runOnQueue(appContext.backgroundCoroutineScope)

    AsyncFunction("resolveHost") { host: String, family: Int ->
      resolveHost(host, family)
    }.runOnQueue(appContext.backgroundCoroutineScope)

    AsyncFunction("icmpPing") { ip: String, options: IcmpPingOptions ->
      val rttMs = sendIcmpEcho(
        ip,
        options,
        onSocketOpen = { fd -> registerIcmpSocket(options.requestId, fd) },
        onSocketClose = { fd -> closeIcmpSocket(options.requestId, fd) }
      )
      IcmpPingResult(rttMs = rttMs)
    }.runOnQueue(appContext.backgroundCoroutineScope)

    AsyncFunction("cancelIcmpPing") { requestId: String ->
      cancelIcmpSocket(requestId)
    }

    OnDestroy {
      cleanupHandler.removeCallbacksAndMessages(null)
      synchronized(icmpSocketLock) {
        activeIcmpSockets.values.forEach(::shutdownIcmpSocket)
      }
      endRouterKeepAlive()
      disableLatencyOptimization()
    }
  }

  private fun registerIcmpSocket(requestId: String, fd: FileDescriptor): Boolean {
    synchronized(icmpSocketLock) {
      if (cancelledIcmpRequests.remove(requestId)) {
        return false
      }
      activeIcmpSockets[requestId] = fd
      return true
    }
  }

  private fun closeIcmpSocket(requestId: String, fd: FileDescriptor) {
    synchronized(icmpSocketLock) {
      activeIcmpSockets.remove(requestId, fd)
      cancelledIcmpRequests.remove(requestId)
      try {
        Os.close(fd)
      } catch (_: ErrnoException) {
        // The module may be shutting down after cancelling active work.
      }
    }
  }

  private fun cancelIcmpSocket(requestId: String) {
    var needsCleanup = false
    synchronized(icmpSocketLock) {
      cancelledIcmpRequests.add(requestId)
      val fd = activeIcmpSockets[requestId]
      if (fd == null) {
        needsCleanup = true
      } else {
        shutdownIcmpSocket(fd)
      }
    }

    if (needsCleanup) {
      cleanupHandler.postDelayed({
        synchronized(icmpSocketLock) {
          if (!activeIcmpSockets.containsKey(requestId)) {
            cancelledIcmpRequests.remove(requestId)
          }
        }
      }, 30_000)
    }
  }

  private fun shutdownIcmpSocket(fd: FileDescriptor) {
    try {
      Os.shutdown(fd, OsConstants.SHUT_RDWR)
    } catch (_: ErrnoException) {
      // The socket owner may already be closing it.
    }
  }

  @Synchronized
  private fun enableLatencyOptimization() {
    try {
      setKeepScreenOn(true)
    } catch (e: Exception) {
      // Optimization is best-effort and must never prevent a test from starting.
      Log.w(TAG, "Failed to enable keep-screen-on", e)
    }

    if (latencyWifiLock?.isHeld == true) {
      Log.i(TAG, "Wi-Fi lock already held for latency optimization")
      return
    }

    val context = appContext.reactContext
    if (context == null) {
      Log.w(TAG, "Failed to acquire Wi-Fi lock: no react context")
      return
    }
    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    if (wifiManager == null) {
      Log.w(TAG, "Failed to acquire Wi-Fi lock: WifiManager unavailable")
      return
    }
    val lockMode = WifiManager.WIFI_MODE_FULL_LOW_LATENCY

    try {
      latencyWifiLock = wifiManager.createWifiLock(lockMode, "PingVista:Latency").apply {
        setReferenceCounted(false)
        acquire()
      }

      if (latencyWifiLock?.isHeld == true) {
        Log.w(TAG, "Acquired Wi-Fi lock for latency optimization")
      } else {
        Log.i(TAG, "Failed to acquire Wi-Fi lock for latency optimization")
      }
    } catch (e: RuntimeException) {
      Log.w(TAG, "Failed to acquire Wi-Fi lock", e)
      latencyWifiLock = null
    }
  }

  @Synchronized
  private fun disableLatencyOptimization() {
    try {
      if (latencyWifiLock?.isHeld == true) {
        latencyWifiLock?.release()
      }
    } catch (e: RuntimeException) {
      // The lock may already have been released by the system.
      Log.w(TAG, "Failed to release Wi-Fi lock", e)
    } finally {
      latencyWifiLock = null
      try {
        setKeepScreenOn(false)
      } catch (e: Exception) {
        // The activity may already be shutting down.
        Log.w(TAG, "Failed to disable keep-screen-on", e)
      }
    }
  }

  private fun setKeepScreenOn(enabled: Boolean) {
    val activity = appContext.currentActivity ?: return
    val updateWindow = {
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    if (Looper.myLooper() == Looper.getMainLooper()) {
      updateWindow()
      return
    }

    val updated = CountDownLatch(1)
    activity.runOnUiThread {
      try {
        updateWindow()
      } finally {
        updated.countDown()
      }
    }
    updated.await(1, TimeUnit.SECONDS)
  }

  @Synchronized
  private fun beginRouterKeepAlive(ip: String, family: Int, intervalMs: Int) {
    if (routerKeepAliveThread != null) {
      Log.i(TAG, "Router keep-alive already running")
      return
    }

    routerKeepAliveRunning = true
    val thread = Thread({ runRouterKeepAliveLoop(ip, family, intervalMs.toLong()) }, "PingVista-RouterKeepAlive")
    thread.isDaemon = true
    thread.start()
    routerKeepAliveThread = thread
  }

  @Synchronized
  private fun endRouterKeepAlive() {
    val thread = routerKeepAliveThread ?: return
    routerKeepAliveRunning = false
    thread.interrupt()
    routerKeepAliveThread = null
    try {
      // Bounded wait so the socket is closed before this call returns, without
      // risking a slow AsyncFunction; the interrupt above breaks Thread.sleep
      // almost immediately.
      thread.join(200)
    } catch (_: InterruptedException) {
      // This thread (the caller) being interrupted mid-join is not our concern.
    }
  }

  // Fire-and-forget: connects once and reuses the same socket for the whole
  // keep-alive session instead of opening/closing a socket every 20ms, which
  // would otherwise churn thousands of file descriptors over a long test. No
  // reply is ever read, so a slow or unresponsive router cannot stall the
  // interval the way sendIcmpEcho's read-with-timeout would. Thread.interrupt()
  // does not reliably interrupt a blocked native Os.write()/Os.connect(), but
  // that's a non-issue here: Os.write() on a connected UDP-style socket to a
  // local-subnet peer (the default gateway is always one hop away) hands the
  // packet to the kernel send buffer immediately and never blocks on the network.
  // Cannot collide with the real test's icmpPing replies: this loop owns its
  // own socket fd for the whole session, and each icmpPing call opens its own
  // separate fd too, so Os.read() in sendIcmpEcho only ever sees packets on its
  // own connected socket. On Android the kernel additionally rewrites the ICMP
  // identifier per unprivileged ping socket, isolating replies at the wire
  // level as well. The `sequence` counter below is purely local packet-building
  // state — never read back, never compared against the real test's JS-assigned
  // seq, and never surfaced to the UI.
  private fun runRouterKeepAliveLoop(ip: String, family: Int, intervalMs: Long) {
    val socketFamily = if (family == 6) OsConstants.AF_INET6 else OsConstants.AF_INET
    val protocol = if (family == 6) OsConstants.IPPROTO_ICMPV6 else OsConstants.IPPROTO_ICMP

    var fd: FileDescriptor? = null
    try {
      val openedFd = Os.socket(socketFamily, OsConstants.SOCK_DGRAM, protocol)
      fd = openedFd
      Os.connect(openedFd, parseDestination(ip), 0)

      val identifier = Process.myPid() and 0xFFFF
      var sequence = 0
      while (routerKeepAliveRunning) {
        sequence = (sequence + 1) and 0xFFFF
        try {
          val packet = buildIcmpPacket(family, identifier, sequence, payloadSize = 0)
          Os.write(fd, packet, 0, packet.size)
        } catch (e: ErrnoException) {
          // Best-effort keep-alive traffic; a transient send failure must not
          // kill the loop for the rest of the test.
          Log.w(TAG, "Router keep-alive ping failed", e)
        }

        try {
          Thread.sleep(intervalMs)
        } catch (_: InterruptedException) {
          break
        }
      }
    } catch (e: ErrnoException) {
      Log.w(TAG, "Router keep-alive could not open socket", e)
    } finally {
      fd?.let { openedFd ->
        try {
          Os.close(openedFd)
        } catch (_: ErrnoException) {
          // Already closing.
        }
      }
    }
  }
}

private fun readDefaultGateways(context: Context?): List<DefaultGatewayInfo> {
  if (context == null) return emptyList()
  val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    ?: return emptyList()
  val network = connectivityManager.activeNetwork ?: return emptyList()
  val linkProperties = connectivityManager.getLinkProperties(network) ?: return emptyList()
  val gateways = mutableListOf<DefaultGatewayInfo>()

  for (route in linkProperties.routes) {
    if (!route.isDefaultRoute) {
      continue
    }

    val gateway = route.gateway ?: continue
    // A directly-connected default route reports the wildcard address as its
    // gateway; there is no router to ping, so skip it.
    if (gateway.isAnyLocalAddress) continue
    val family = when (gateway) {
      is Inet4Address -> 4
      is Inet6Address -> 6
      else -> continue
    }

    if (gateways.any { it.family == family }) {
      continue
    }

    var ip = gateway.hostAddress?.substringBefore('%') ?: continue
    val interfaceName = route.`interface` ?: linkProperties.interfaceName ?: ""
    if (family == 6 && gateway.isLinkLocalAddress && interfaceName.isNotEmpty()) {
      ip += "%$interfaceName"
    }
    gateways.add(DefaultGatewayInfo(ip, family, interfaceName))
  }

  return gateways
}

private fun readNetworkInterfaces(): List<NetworkInterfaceInfo> {
  val result = mutableListOf<NetworkInterfaceInfo>()
  val interfaces = NetworkInterface.getNetworkInterfaces() ?: return result

  for (iface in Collections.list(interfaces)) {
    if (!iface.isUp || iface.isLoopback) {
      continue
    }

    val addresses = mutableListOf<InterfaceAddressInfo>()
    for (addr in Collections.list(iface.inetAddresses)) {
      val family = when (addr) {
        is Inet4Address -> 4
        is Inet6Address -> 6
        else -> continue
      }
      // Link-local IPv6 addresses come back as "fe80::1%wlan0"; drop the scope suffix.
      val ip = addr.hostAddress?.substringBefore('%') ?: continue
      addresses.add(InterfaceAddressInfo(ip = ip, family = family))
    }

    if (addresses.isNotEmpty()) {
      result.add(NetworkInterfaceInfo(name = iface.name, addresses = addresses))
    }
  }

  return result
}

private fun resolveHost(host: String, family: Int): String {
  try {
    if (host.contains('%')) {
      val scopedAddress = parseDestination(host)
      val matchesFamily = if (family == 6) scopedAddress is Inet6Address else scopedAddress is Inet4Address
      if (!matchesFamily) {
        throw PingException("No IPv$family address found for $host")
      }

      // Keep the interface scope: pingIcmp() always resolves through this
      // function, including for link-local gateways from getDefaultGateways,
      // and sendIcmpEcho's connect() needs the scope to route to them.
      return scopedAddress.hostAddress ?: throw PingException("Could not resolve $host")
    }

    val addresses = InetAddress.getAllByName(host)
    val match = addresses.firstOrNull { addr ->
      if (family == 6) addr is Inet6Address else addr is Inet4Address
    } ?: throw PingException("No IPv$family address found for $host")
    return match.hostAddress ?: throw PingException("Could not resolve $host")
  } catch (e: UnknownHostException) {
    throw PingException("Could not resolve $host")
  }
}

private fun sendIcmpEcho(
  ip: String,
  options: IcmpPingOptions,
  onSocketOpen: (FileDescriptor) -> Boolean,
  onSocketClose: (FileDescriptor) -> Unit
): Double {
  validateIcmpOptions(options)
  val family = if (options.family == 6) OsConstants.AF_INET6 else OsConstants.AF_INET
  val protocol = if (options.family == 6) OsConstants.IPPROTO_ICMPV6 else OsConstants.IPPROTO_ICMP

  val fd: FileDescriptor = try {
    Os.socket(family, OsConstants.SOCK_DGRAM, protocol)
  } catch (e: ErrnoException) {
    throw PingException("Could not open ICMP socket: ${e.message}")
  }

  var socketIsRegistered = false
  try {
    val ttlLevel = if (options.family == 6) OsConstants.IPPROTO_IPV6 else OsConstants.IPPROTO_IP
    val ttlOption = if (options.family == 6) OsConstants.IPV6_UNICAST_HOPS else OsConstants.IP_TTL
    Os.setsockoptInt(fd, ttlLevel, ttlOption, options.ttl)
    Os.connect(fd, parseDestination(ip), 0)

    // Register only after connect(). Cancellation that arrived during socket
    // setup is now observed before write(), while later shutdown() calls
    // operate on a connected socket and reliably interrupt read().
    if (!onSocketOpen(fd)) {
      throw PingException("Ping cancelled")
    }
    socketIsRegistered = true

    val identifier = Process.myPid() and 0xFFFF
    // JS drives the loop and passes seq so the on-wire ICMP sequence matches
    // the value shown in the UI. options.seq defaults to 1 in the Record.
    val packet = buildIcmpPacket(options.family, identifier, sequence = options.seq, payloadSize = maxOf(0, options.packetSize))

    val start = System.nanoTime()
    val sent = Os.write(fd, packet, 0, packet.size)
    if (sent != packet.size) {
      throw PingException("Failed to send ping")
    }

    // SO_RCVTIMEO bounds a single Os.read() call, not this whole loop, so a
    // stray non-matching packet arriving before the real reply would
    // otherwise reset the wait on every iteration. Track a deadline instead
    // and shrink the socket timeout to match on each pass.
    val deadlineNanos = start + options.timeoutMs.toLong() * 1_000_000
    val buffer = ByteArray(2048)
    while (true) {
      val remainingMs = (deadlineNanos - System.nanoTime()) / 1_000_000
      if (remainingMs <= 0) {
        throw PingException("Request timed out")
      }
      Os.setsockoptTimeval(
        fd, OsConstants.SOL_SOCKET, OsConstants.SO_RCVTIMEO,
        StructTimeval.fromMillis(remainingMs)
      )

      val received: Int
      try {
        received = Os.read(fd, buffer, 0, buffer.size)
      } catch (e: ErrnoException) {
        if (e.errno == OsConstants.EAGAIN) {
          throw PingException("Request timed out")
        }
        // A signal-interrupted read is not a failure; the loop re-checks the
        // deadline and waits again.
        if (e.errno == OsConstants.EINTR) {
          continue
        }
        throw PingException("Ping failed: ${e.message}")
      }
      if (received == 0) {
        throw PingException("Ping cancelled")
      }
      if (isEchoReply(buffer, received, options.family, options.seq)) {
        break
      }
      // Not our reply (stray packet on the same socket) — keep waiting until the deadline.
    }

    return (System.nanoTime() - start) / 1_000_000.0
  } finally {
    if (socketIsRegistered) {
      onSocketClose(fd)
    } else {
      try {
        Os.close(fd)
      } catch (_: ErrnoException) {
        // Socket setup failed before it was registered.
      }
    }
  }
}

// These bounds must match MIN/MAX_PACKET_SIZE and MIN/MAX_TTL in
// src/constants.ts, which is the source of truth the UI validates against.
// The check is repeated here because the native module is callable directly.
private fun validateIcmpOptions(options: IcmpPingOptions) {
  if (options.packetSize !in 0..1_400) {
    throw PingException("Packet size must be between 0 and 1400 bytes")
  }
  if (options.ttl !in 1..255) {
    throw PingException("TTL must be between 1 and 255")
  }
  if (options.timeoutMs <= 0) {
    throw PingException("Timeout must be greater than zero")
  }
  if (options.requestId.isEmpty()) {
    throw PingException("Request ID must not be empty")
  }
  if (options.family != 4 && options.family != 6) {
    throw PingException("family must be 4 or 6")
  }
}

private fun parseDestination(ip: String): InetAddress {
  val separator = ip.lastIndexOf('%')
  if (separator < 0) {
    return InetAddress.getByName(ip)
  }

  val address = InetAddress.getByName(ip.substring(0, separator))
  val interfaceName = ip.substring(separator + 1)
  if (address !is Inet6Address || interfaceName.isEmpty()) {
    return address
  }

  val networkInterface = NetworkInterface.getByName(interfaceName)
    ?: throw PingException("Unknown network interface: $interfaceName")

  return Inet6Address.getByAddress(null, address.address, networkInterface)
}

private fun buildIcmpPacket(family: Int, identifier: Int, sequence: Int, payloadSize: Int): ByteArray {
  val packet = ByteArray(8 + payloadSize)
  packet[0] = if (family == 6) 128.toByte() else 8.toByte() // echo request
  packet[1] = 0 // code
  packet[2] = 0 // checksum (filled below for v4; kernel fills it for v6)
  packet[3] = 0
  packet[4] = (identifier shr 8).toByte()
  packet[5] = (identifier and 0xFF).toByte()
  packet[6] = (sequence shr 8).toByte()
  packet[7] = (sequence and 0xFF).toByte()
  for (i in 0 until payloadSize) {
    packet[8 + i] = (i and 0xFF).toByte()
  }

  if (family != 6) {
    val sum = internetChecksum(packet)
    packet[2] = (sum shr 8).toByte()
    packet[3] = (sum and 0xFF).toByte()
  }

  return packet
}

private fun internetChecksum(bytes: ByteArray): Int {
  var sum = 0L
  var i = 0
  while (i + 1 < bytes.size) {
    sum += ((bytes[i].toInt() and 0xFF) shl 8) or (bytes[i + 1].toInt() and 0xFF)
    i += 2
  }
  if (i < bytes.size) {
    sum += (bytes[i].toInt() and 0xFF) shl 8
  }
  while (sum shr 16 != 0L) {
    sum = (sum and 0xFFFF) + (sum shr 16)
  }
  return (sum.inv() and 0xFFFF).toInt()
}

private fun isEchoReply(buffer: ByteArray, length: Int, family: Int, sequence: Int): Boolean {
  if (length < 8) return false
  val expectedType = if (family == 6) 129 else 0
  val replySequence = ((buffer[6].toInt() and 0xFF) shl 8) or (buffer[7].toInt() and 0xFF)
  return (buffer[0].toInt() and 0xFF) == expectedType && replySequence == (sequence and 0xFFFF)
}
