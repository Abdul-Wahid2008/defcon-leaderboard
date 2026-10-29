// Generated with the Supabase MCP generate_typescript_types for project defcon-leaderboard on 29 Oct 2026, schema lb_init.
// Only the Database and Json types are kept; regenerate after any migration instead of editing by hand.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      lb_audit: {
        Row: { action: string; actor: string; details: Json | null; id: number; ts: string };
        Insert: { action: string; actor: string; details?: Json | null; id?: never; ts?: string };
        Update: { action?: string; actor?: string; details?: Json | null; id?: never; ts?: string };
        Relationships: [];
      };
      lb_events: {
        Row: { created_at: string; ends_at: string | null; freeze_at: string | null; id: string; name: string | null; slug: string; starts_at: string | null };
        Insert: { created_at?: string; ends_at?: string | null; freeze_at?: string | null; id?: string; name?: string | null; slug: string; starts_at?: string | null };
        Update: { created_at?: string; ends_at?: string | null; freeze_at?: string | null; id?: string; name?: string | null; slug?: string; starts_at?: string | null };
        Relationships: [];
      };
      lb_rounds: {
        Row: { captured_at: string; event_id: string; round: number };
        Insert: { captured_at: string; event_id: string; round: number };
        Update: { captured_at?: string; event_id?: string; round?: number };
        Relationships: [
          { foreignKeyName: 'lb_rounds_event_id_fkey'; columns: ['event_id']; isOneToOne: false; referencedRelation: 'lb_events'; referencedColumns: ['id'] },
        ];
      };
      lb_scores: {
        Row: { attack: number | null; defense: number | null; event_id: string; rank: number; round: number; sla: number | null; team_id: string; team_name: string; total: number };
        Insert: { attack?: number | null; defense?: number | null; event_id: string; rank: number; round: number; sla?: number | null; team_id: string; team_name: string; total: number };
        Update: { attack?: number | null; defense?: number | null; event_id?: string; rank?: number; round?: number; sla?: number | null; team_id?: string; team_name?: string; total?: number };
        Relationships: [
          { foreignKeyName: 'lb_scores_event_id_round_fkey'; columns: ['event_id', 'round']; isOneToOne: false; referencedRelation: 'lb_rounds'; referencedColumns: ['event_id', 'round'] },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
