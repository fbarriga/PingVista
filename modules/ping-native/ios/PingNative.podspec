Pod::Spec.new do |s|
  s.name           = 'PingNative'
  s.version        = '1.0.0'
  s.summary        = 'Native ICMP ping and network interface info for PingVista'
  s.description    = 'Unprivileged ICMP echo, interface listing, and DNS resolution used by PingVista.'
  s.author         = 'Felipe Barriga Richards'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
