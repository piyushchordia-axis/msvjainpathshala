'use client';

/**
 * AnalyticsCharts — client-side Recharts wrapper for the admin dashboard.
 *
 * Two charts:
 *   - LineChart: 30-day attendance trend (saffron stroke, cream fill).
 *   - BarChart : spiritual-tier distribution using the locked tier
 *     palette per CLAUDE.md (Jigyasu / Shravak / Sadhak / Shraman /
 *     Tirthankar).
 */

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface ChartProps {
  trend: Array<{ day: string; rate: number }>;
  tierBars: Array<{ tier: string; count: number; fill: string }>;
}

export default function AnalyticsCharts({ trend, tierBars }: ChartProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Attendance — last 30 days</CardTitle>
          <CardDescription>Daily average across centres in your scope.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {trend.length === 0 ? (
            <EmptyState text="Attendance trend will appear after the nightly view refresh." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 12, right: 8, left: -8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6D8C2" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8B6F5E' }} />
                <YAxis tick={{ fontSize: 10, fill: '#8B6F5E' }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    background: '#FFFFFF',
                    border: '1px solid #E6D8C2',
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: '#1A0A00' }}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="#D4621A"
                  strokeWidth={2.5}
                  dot={{ fill: '#D4621A', r: 3 }}
                  activeDot={{ r: 5, fill: '#7A1818' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spiritual tier distribution</CardTitle>
          <CardDescription>Active students grouped by lifetime Punya tier.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {tierBars.length === 0 ? (
            <EmptyState text="Tier distribution will appear once Punya has been awarded." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tierBars} margin={{ top: 16, right: 8, left: -8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6D8C2" />
                <XAxis dataKey="tier" tick={{ fontSize: 11, fill: '#8B6F5E' }} />
                <YAxis tick={{ fontSize: 10, fill: '#8B6F5E' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#FFFFFF',
                    border: '1px solid #E6D8C2',
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="count" radius={[8, 8, 4, 4]}>
                  {tierBars.map((entry) => (
                    <Cell key={entry.tier} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
