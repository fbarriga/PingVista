// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import MainScreen from './src/screens/MainScreen';
import InfoScreen from './src/screens/InfoScreen';
import AboutScreen from './src/screens/AboutScreen';

type RootTabParamList = {
  Main: undefined;
  Info: undefined;
  About: undefined;
};

const tabIcons = {
  Main: { active: 'pulse', inactive: 'pulse-outline' },
  Info: { active: 'globe', inactive: 'globe-outline' },
  About: { active: 'information-circle', inactive: 'information-circle-outline' },
} as const;

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <NavigationContainer>
            <StatusBar style="auto" />
            <Tab.Navigator
              screenOptions={({ route }) => ({
                headerTitleAlign: 'center',
                headerShown: false,
                tabBarActiveTintColor: '#2563eb',
                tabBarInactiveTintColor: '#64748b',
                tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
                tabBarIcon: ({ color, focused, size }) => {
                  const names = tabIcons[route.name];
                  return <Ionicons name={focused ? names.active : names.inactive} size={size} color={color} />;
                },
              })}
            >
              <Tab.Screen name="Main" component={MainScreen} />
              <Tab.Screen name="Info" component={InfoScreen} />
              <Tab.Screen name="About" component={AboutScreen} />
            </Tab.Navigator>
          </NavigationContainer>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
