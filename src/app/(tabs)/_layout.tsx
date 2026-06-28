import { Tabs } from 'expo-router';
import { useColorScheme, type ColorValue } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { palette } from '@/theme/colors';

const tabIcon = (name: IconName) => {
  function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={name} size={26} color={color as string} weight={focused ? 'fill' : 'duotone'} />;
  }
  return TabBarIcon;
};

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? palette.frosting[300] : palette.frosting[600],
        tabBarInactiveTintColor: dark ? palette.night.textMuted : '#BCA9D2',
        tabBarStyle: {
          backgroundColor: dark ? palette.night.surface : palette.white,
          borderTopColor: dark ? palette.night.border : palette.frosting[100],
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: 'Nunito_700Bold', fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Globe', tabBarIcon: tabIcon('globe') }} />
      <Tabs.Screen name="markets" options={{ title: 'Markets', tabBarIcon: tabIcon('markets') }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: tabIcon('portfolio') }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents', tabBarIcon: tabIcon('agents') }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: tabIcon('history') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
