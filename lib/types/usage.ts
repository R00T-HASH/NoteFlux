export interface UsageRecord {
  id: string;
  user_id: string;
  session_id: string;
  seconds_used: number;
  voice_agent: 'deepgram';
  model: string;
  created_at: string;
}

export interface UserUsage {
  user_id: string;
  total_seconds_used: number;
  seconds_remaining: number;
  free_tier_limit: number;
  last_reset_date: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUsageData {
  session_id: string;
  seconds_used: number;
  voice_agent: 'deepgram';
  model: string;
} 