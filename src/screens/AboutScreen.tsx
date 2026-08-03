// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import appConfig from '../../app.json';

const homepageUrl = 'https://github.com/fbarriga/pingvista';

export default function AboutScreen() {
  return (
    <View style={styles.container}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} />
      <Text style={styles.title}>{appConfig.expo.name}</Text>
      <Text style={styles.subtitle}>Version {appConfig.expo.version}</Text>
      <Text style={styles.description}>
        Measure ICMP, HTTPS, TCP, and UDP latency. ICMP, TCP, and UDP support IPv4 and IPv6.
      </Text>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(homepageUrl)}>
        <Text style={styles.homepage}>{homepageUrl}</Text>
      </Pressable>
      <Text style={styles.aiAcknowledgement}>
        Development was assisted by AI coding tools, including Claude, OpenAI Codex, and OpenCode. All
        code and design decisions were reviewed and integrated by the developer.
      </Text>
      <Text style={styles.copyright}>Copyright © 2026 Felipe Barriga Richards</Text>
      <Text style={styles.license}>
        All rights reserved. Source available for viewing and evaluation only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { width: 112, height: 112, borderRadius: 24 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 12 },
  subtitle: { fontSize: 13, color: '#666', marginTop: 4 },
  description: { fontSize: 14, color: '#444', textAlign: 'center', marginTop: 16 },
  homepage: { fontSize: 13, color: '#2563eb', marginTop: 12, textDecorationLine: 'underline' },
  aiAcknowledgement: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 20 },
  copyright: { fontSize: 12, color: '#666', marginTop: 28, textAlign: 'center' },
  license: { fontSize: 12, color: '#666', marginTop: 4, textAlign: 'center' },
});
