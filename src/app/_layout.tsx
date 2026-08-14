import '@/global.css';

import {
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from '@expo-google-fonts/nunito';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initAuth } from '@/lib/auth/store';
import { queryClient } from '@/lib/query';
import { theme } from '@/theme/colors';

export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync().catch(() => {});

// Start mirroring the (optional) Supabase session into the auth store so run
// headers / configurable pick up the live token from the first request on.
initAuth();

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const t = dark ? theme.dark : theme.light;

  const [fontsLoaded] = useFonts({
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              headerTintColor: t.primary,
              headerStyle: { backgroundColor: t.surface },
              headerTitleStyle: { fontFamily: 'Baloo2_700Bold', color: t.text },
              contentStyle: { backgroundColor: t.background },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="agents/[assistantId]"
              options={{ headerShown: true, title: 'Agent' }}
            />
            <Stack.Screen name="calls/[threadId]" options={{ headerShown: true, title: 'Call' }} />
            <Stack.Screen name="group/[groupId]" options={{ headerShown: true, title: 'Group' }} />
            <Stack.Screen name="region/[regionId]" options={{ headerShown: true, title: 'Region' }} />
            <Stack.Screen name="country/[countryId]" options={{ headerShown: true, title: 'Country' }} />
            <Stack.Screen name="other" options={{ headerShown: true, title: 'Other' }} />
            <Stack.Screen name="sector/[sectorId]" options={{ headerShown: true, title: 'Sector' }} />
            <Stack.Screen name="stock/[ticker]" options={{ headerShown: true, title: 'Stock' }} />
            <Stack.Screen name="account/[accountId]" options={{ headerShown: true, title: 'Account' }} />
            <Stack.Screen name="goal/[goalId]" options={{ headerShown: true, title: 'Goal' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
