/**
 * Splash router. While AuthProvider is in `booting` we render a centered
 * spinner on the cream background; once it resolves we redirect to either
 * `/login` (unauthenticated) or the role-specific tab group.
 *
 * The mapping from `role` (+ optional student view) to a route lives here
 * because (a) only the entry router needs it and (b) it's the only spot
 * that re-routes on role change (e.g. after switch-view).
 */

import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { JPColors } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';

import type { Role } from '@jp/shared';

function routeForRole(role: Role, view: 'parent' | 'student' | null): string {
  if (role === 'parent' && view === 'student') return '/(tabs)/student-view/home';
  switch (role) {
    case 'super_admin':
      return '/(tabs)/super-admin/dashboard';
    case 'state_admin':
      return '/(tabs)/state-admin/dashboard';
    case 'city_admin':
      return '/(tabs)/city-admin/dashboard';
    case 'sanchalak':
      return '/(tabs)/sanchalak/dashboard';
    case 'shikshak':
      return '/(tabs)/shikshak/today';
    case 'parent':
      return '/(tabs)/parent/home';
    case 'student':
      return '/(tabs)/student-view/home';
    case 'guest':
    default:
      return '/(tabs)/guest/centres';
  }
}

export default function Index() {
  const { status, user, view } = useAuth();

  if (status === 'booting') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: JPColors.cream,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  if (status === 'unauthenticated' || !user) {
    return <Redirect href="/(auth)/phone" />;
  }

  return <Redirect href={routeForRole(user.role, view) as never} />;
}
