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

// Built once at module scope — calling the factory inside render would mint a
// new component type (state-losing remount) per render.
const TAB_ICONS = {
  globe: tabIcon('globe'),
  markets: tabIcon('markets'),
  portfolio: tabIcon('portfolio'),
  agents: tabIcon('agents'),
  history: tabIcon('history'),
  settings: tabIcon('settings'),
};

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? palette.frosting[300] : palette.frosting[600],
        tabBarInactiveTintColor: dark ? palette.night.textMuted : palette.inkFaint,
        tabBarStyle: {
          backgroundColor: dark ? palette.night.surface : palette.white,
          borderTopColor: dark ? palette.night.border : palette.frosting[100],
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: 'Nunito_700Bold', fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Globe', tabBarIcon: TAB_ICONS.globe }} />
      <Tabs.Screen name="markets" options={{ title: 'Markets', tabBarIcon: TAB_ICONS.markets }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: TAB_ICONS.portfolio }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents', tabBarIcon: TAB_ICONS.agents }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: TAB_ICONS.history }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: TAB_ICONS.settings }} />
    </Tabs>
  );
}
