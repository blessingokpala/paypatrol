export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      approvals: {
        Row: {
          amount_minor: number
          approver_id: string
          created_at: string
          currency: string
          digest: string
          id: string
          invalidated_at: string | null
          invalidated_reason: string | null
          is_valid: boolean
          note: string | null
          org_id: string
          policy_version_id: string | null
          purchase_id: string
          purchase_version: number
          recipient: string | null
          supplier_version_id: string | null
        }
        Insert: {
          amount_minor: number
          approver_id: string
          created_at?: string
          currency: string
          digest: string
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          is_valid?: boolean
          note?: string | null
          org_id: string
          policy_version_id?: string | null
          purchase_id: string
          purchase_version: number
          recipient?: string | null
          supplier_version_id?: string | null
        }
        Update: {
          amount_minor?: number
          approver_id?: string
          created_at?: string
          currency?: string
          digest?: string
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          is_valid?: boolean
          note?: string | null
          org_id?: string
          policy_version_id?: string | null
          purchase_id?: string
          purchase_version?: number
          recipient?: string | null
          supplier_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          entity_version: number | null
          hash: string | null
          id: number
          org_id: string
          prev_hash: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          entity_version?: number | null
          hash?: string | null
          id?: number
          org_id: string
          prev_hash?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          entity_version?: number | null
          hash?: string | null
          id?: number
          org_id?: string
          prev_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_reservations: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          id: string
          org_id: string
          period_start: string
          purchase_id: string
          purchase_version: number
          released_at: string | null
          status: Database["public"]["Enums"]["reservation_status"]
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          org_id: string
          period_start: string
          purchase_id: string
          purchase_version: number
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          org_id?: string
          period_start?: string
          purchase_id?: string
          purchase_version?: number
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "budget_reservations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_reservations_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      findings: {
        Row: {
          code: string
          created_at: string
          id: string
          message: string
          next_action: string | null
          org_id: string
          purchase_id: string
          purchase_version: number
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          message: string
          next_action?: string | null
          org_id: string
          purchase_id: string
          purchase_version: number
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          message?: string
          next_action?: string | null
          org_id?: string
          purchase_id?: string
          purchase_version?: number
          severity?: Database["public"]["Enums"]["finding_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_documents: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          org_id: string
          purchase_id: string
          source_message: string | null
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          org_id: string
          purchase_id: string
          source_message?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          org_id?: string
          purchase_id?: string
          source_message?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_documents_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          category: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          max_quantity: number
          name: string
          org_id: string
          pack_size: number
          source: string | null
          supplier_id: string
          unit_price_minor: number
          untrusted_description: string | null
        }
        Insert: {
          category: string
          created_at?: string
          currency: string
          id?: string
          is_active?: boolean
          max_quantity?: number
          name: string
          org_id: string
          pack_size?: number
          source?: string | null
          supplier_id: string
          unit_price_minor: number
          untrusted_description?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          max_quantity?: number
          name?: string
          org_id?: string
          pack_size?: number
          source?: string | null
          supplier_id?: string
          unit_price_minor?: number
          untrusted_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payment_attempts: {
        Row: {
          created_at: string
          created_by: string | null
          error_detail: string | null
          id: string
          idempotency_key: string
          org_id: string
          purchase_id: string
          purchase_version: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          purchase_id: string
          purchase_version: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          purchase_id?: string
          purchase_version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_attempts_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_captures: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: string | null
          id: string
          org_id: string
          paypal_capture_id: string
          paypal_order_row_id: string
          raw: Json | null
          status: string
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id: string
          paypal_capture_id: string
          paypal_order_row_id: string
          raw?: Json | null
          status: string
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id?: string
          paypal_capture_id?: string
          paypal_order_row_id?: string
          raw?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_captures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paypal_captures_paypal_order_row_id_fkey"
            columns: ["paypal_order_row_id"]
            isOneToOne: false
            referencedRelation: "paypal_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_orders: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: string | null
          id: string
          org_id: string
          payee_merchant_id: string | null
          payment_attempt_id: string
          paypal_order_id: string
          raw: Json | null
          status: string
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id: string
          payee_merchant_id?: string | null
          payment_attempt_id: string
          paypal_order_id: string
          raw?: Json | null
          status: string
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id?: string
          payee_merchant_id?: string | null
          payment_attempt_id?: string
          paypal_order_id?: string
          raw?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paypal_orders_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_line_items: {
        Row: {
          category: string | null
          created_at: string
          description: string
          id: string
          line_total_minor: number
          listing_id: string | null
          org_id: string
          purchase_id: string
          quantity: number
          unit_price_minor: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          description: string
          id?: string
          line_total_minor: number
          listing_id?: string | null
          org_id: string
          purchase_id: string
          quantity: number
          unit_price_minor: number
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          line_total_minor?: number
          listing_id?: string | null
          org_id?: string
          purchase_id?: string
          quantity?: number
          unit_price_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          ai_claims: Json | null
          category: string | null
          created_at: string
          currency: string
          digest: string | null
          fixture_label: string | null
          id: string
          invoice_reference: string | null
          is_test_fixture: boolean
          org_id: string
          policy_version_id: string | null
          requested_by: string
          requested_contact: string | null
          requested_recipient: string | null
          source: Database["public"]["Enums"]["purchase_source"]
          status: Database["public"]["Enums"]["purchase_status"]
          supplier_id: string | null
          supplier_version_id: string | null
          title: string
          total_minor: number
          updated_at: string
          version: number
        }
        Insert: {
          ai_claims?: Json | null
          category?: string | null
          created_at?: string
          currency: string
          digest?: string | null
          fixture_label?: string | null
          id?: string
          invoice_reference?: string | null
          is_test_fixture?: boolean
          org_id: string
          policy_version_id?: string | null
          requested_by: string
          requested_contact?: string | null
          requested_recipient?: string | null
          source: Database["public"]["Enums"]["purchase_source"]
          status?: Database["public"]["Enums"]["purchase_status"]
          supplier_id?: string | null
          supplier_version_id?: string | null
          title: string
          total_minor?: number
          updated_at?: string
          version?: number
        }
        Update: {
          ai_claims?: Json | null
          category?: string | null
          created_at?: string
          currency?: string
          digest?: string | null
          fixture_label?: string | null
          id?: string
          invoice_reference?: string | null
          is_test_fixture?: boolean
          org_id?: string
          policy_version_id?: string | null
          requested_by?: string
          requested_contact?: string | null
          requested_recipient?: string | null
          source?: Database["public"]["Enums"]["purchase_source"]
          status?: Database["public"]["Enums"]["purchase_status"]
          supplier_id?: string | null
          supplier_version_id?: string | null
          title?: string
          total_minor?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "spending_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_version_id_fkey"
            columns: ["supplier_version_id"]
            isOneToOne: false
            referencedRelation: "supplier_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      spending_policies: {
        Row: {
          allowed_categories: string[]
          allowed_supplier_ids: string[]
          approval_threshold_minor: number
          created_at: string
          created_by: string | null
          currency: string
          id: string
          is_active: boolean
          is_demo: boolean
          order_limit_minor: number
          org_id: string
          timezone: string
          version: number
          weekly_limit_minor: number
        }
        Insert: {
          allowed_categories?: string[]
          allowed_supplier_ids?: string[]
          approval_threshold_minor: number
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          order_limit_minor: number
          org_id: string
          timezone: string
          version: number
          weekly_limit_minor: number
        }
        Update: {
          allowed_categories?: string[]
          allowed_supplier_ids?: string[]
          approval_threshold_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          order_limit_minor?: number
          org_id?: string
          timezone?: string
          version?: number
          weekly_limit_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "spending_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_change_requests: {
        Row: {
          base_version_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          org_id: string
          proposed_by: string
          proposed_contact: string | null
          proposed_recipient: string
          purchase_id: string | null
          resulting_version_id: string | null
          status: Database["public"]["Enums"]["change_status"]
          supplier_id: string
        }
        Insert: {
          base_version_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          org_id: string
          proposed_by: string
          proposed_contact?: string | null
          proposed_recipient: string
          purchase_id?: string | null
          resulting_version_id?: string | null
          status?: Database["public"]["Enums"]["change_status"]
          supplier_id: string
        }
        Update: {
          base_version_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          org_id?: string
          proposed_by?: string
          proposed_contact?: string | null
          proposed_recipient?: string
          purchase_id?: string | null
          resulting_version_id?: string | null
          status?: Database["public"]["Enums"]["change_status"]
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_change_requests_base_version_id_fkey"
            columns: ["base_version_id"]
            isOneToOne: false
            referencedRelation: "supplier_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_change_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_change_requests_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_change_requests_resulting_version_id_fkey"
            columns: ["resulting_version_id"]
            isOneToOne: false
            referencedRelation: "supplier_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_change_requests_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          enrolment_status: Database["public"]["Enums"]["enrolment_status"]
          id: string
          org_id: string
          paypal_merchant_id: string
          recipient_email: string | null
          status: string
          supplier_id: string
          trusted_contact_channel: string
          trusted_contact_value: string
          verification_evidence: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          enrolment_status?: Database["public"]["Enums"]["enrolment_status"]
          id?: string
          org_id: string
          paypal_merchant_id: string
          recipient_email?: string | null
          status?: string
          supplier_id: string
          trusted_contact_channel: string
          trusted_contact_value: string
          verification_evidence?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          enrolment_status?: Database["public"]["Enums"]["enrolment_status"]
          id?: string
          org_id?: string
          paypal_merchant_id?: string
          recipient_email?: string | null
          status?: string
          supplier_id?: string
          trusted_contact_channel?: string
          trusted_contact_value?: string
          verification_evidence?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_versions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          created_by: string | null
          current_version_id: string | null
          id: string
          is_demo: boolean
          name: string
          org_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          is_demo?: boolean
          name: string
          org_id: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_records: {
        Row: {
          change_request_id: string | null
          channel: string
          channel_value: string
          contacted_at: string
          created_at: string
          evidence: string
          id: string
          org_id: string
          outcome: Database["public"]["Enums"]["verification_outcome"]
          person_contacted: string
          reviewer_id: string
          supplier_id: string | null
        }
        Insert: {
          change_request_id?: string | null
          channel: string
          channel_value: string
          contacted_at: string
          created_at?: string
          evidence: string
          id?: string
          org_id: string
          outcome: Database["public"]["Enums"]["verification_outcome"]
          person_contacted: string
          reviewer_id: string
          supplier_id?: string | null
        }
        Update: {
          change_request_id?: string | null
          channel?: string
          channel_value?: string
          contacted_at?: string
          created_at?: string
          evidence?: string
          id?: string
          org_id?: string
          outcome?: Database["public"]["Enums"]["verification_outcome"]
          person_contacted?: string
          reviewer_id?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_records_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "supplier_change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_records_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          org_id: string | null
          payload: Json | null
          processed_at: string | null
          provider: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          org_id?: string | null
          payload?: Json | null
          processed_at?: string | null
          provider: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          org_id?: string | null
          payload?: Json | null
          processed_at?: string | null
          provider?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_policy_id: { Args: { _org: string }; Returns: string }
      add_member_by_email: {
        Args: {
          _email: string
          _org: string
          _role: Database["public"]["Enums"]["member_role"]
        }
        Returns: undefined
      }
      approve_purchase: {
        Args: { _note?: string; _pid: string; _version: number }
        Returns: Database["public"]["Enums"]["purchase_status"]
      }
      approve_supplier_baseline: {
        Args: { _supplier: string }
        Returns: undefined
      }
      cancel_purchase: {
        Args: { _pid: string; _reason: string }
        Returns: undefined
      }
      create_organization: {
        Args: { _name: string; _with_demo?: boolean }
        Returns: string
      }
      create_supplier: {
        Args: {
          _channel: string
          _channel_value: string
          _email: string
          _evidence: string
          _merchant: string
          _name: string
          _org: string
        }
        Returns: string
      }
      decide_supplier_change: {
        Args: { _approve: boolean; _cr: string; _note: string }
        Returns: undefined
      }
      edit_purchase: {
        Args: {
          _amount_minor: number
          _category: string
          _currency: string
          _invoice_ref: string
          _pid: string
          _recipient: string
        }
        Returns: Database["public"]["Enums"]["purchase_status"]
      }
      evaluate_purchase: {
        Args: { _pid: string }
        Returns: Database["public"]["Enums"]["purchase_status"]
      }
      has_org_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["member_role"]
        }
        Returns: boolean
      }
      invalidate_approvals: {
        Args: { _pid: string; _reason: string }
        Returns: number
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      log_audit: {
        Args: {
          _action: string
          _actor_kind?: string
          _details: Json
          _eid: string
          _etype: string
          _ever: number
          _org: string
        }
        Returns: undefined
      }
      org_week_start: { Args: { _tz: string }; Returns: string }
      purchase_digest: { Args: { _pid: string }; Returns: string }
      recheck_purchase: {
        Args: { _pid: string }
        Returns: Database["public"]["Enums"]["purchase_status"]
      }
      record_verification: {
        Args: {
          _channel_value: string
          _contacted_at: string
          _cr: string
          _evidence: string
          _outcome: Database["public"]["Enums"]["verification_outcome"]
          _person: string
        }
        Returns: string
      }
      release_reservation: { Args: { _pid: string }; Returns: undefined }
      remove_member_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["member_role"]
          _user: string
        }
        Returns: undefined
      }
      reserve_budget: { Args: { _pid: string }; Returns: string }
      submit_ai_proposal: {
        Args: {
          _claimed_recipient?: string
          _claimed_total_minor?: number
          _fixture_label?: string
          _is_test_fixture?: boolean
          _listing: string
          _org: string
          _quantity: number
        }
        Returns: string
      }
      submit_invoice: {
        Args: {
          _amount_minor: number
          _category: string
          _contact: string
          _currency: string
          _description: string
          _file_name: string
          _invoice_ref: string
          _message: string
          _org: string
          _recipient: string
          _storage_path: string
          _supplier: string
        }
        Returns: string
      }
      update_spending_policy: {
        Args: {
          _categories: string[]
          _currency: string
          _order: number
          _org: string
          _suppliers: string[]
          _threshold: number
          _timezone: string
          _weekly: number
        }
        Returns: string
      }
      week_committed_minor: {
        Args: { _exclude?: string; _org: string }
        Returns: number
      }
    }
    Enums: {
      change_status:
        | "pending_verification"
        | "verified_pending_decision"
        | "approved"
        | "rejected"
      enrolment_status: "not_enrolled" | "pending" | "enrolled" | "demo_fixture"
      finding_severity: "info" | "warning" | "block"
      member_role: "owner" | "preparer" | "change_approver" | "payer"
      purchase_source: "invoice" | "ai_proposal"
      purchase_status:
        | "draft"
        | "needs_clarification"
        | "blocked"
        | "verification_required"
        | "approval_required"
        | "cleared_for_checkout"
        | "payment_pending"
        | "paid"
        | "failed"
        | "cancelled"
      reservation_status: "active" | "released" | "consumed"
      verification_outcome: "confirmed" | "denied" | "unreachable"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      change_status: [
        "pending_verification",
        "verified_pending_decision",
        "approved",
        "rejected",
      ],
      enrolment_status: ["not_enrolled", "pending", "enrolled", "demo_fixture"],
      finding_severity: ["info", "warning", "block"],
      member_role: ["owner", "preparer", "change_approver", "payer"],
      purchase_source: ["invoice", "ai_proposal"],
      purchase_status: [
        "draft",
        "needs_clarification",
        "blocked",
        "verification_required",
        "approval_required",
        "cleared_for_checkout",
        "payment_pending",
        "paid",
        "failed",
        "cancelled",
      ],
      reservation_status: ["active", "released", "consumed"],
      verification_outcome: ["confirmed", "denied", "unreachable"],
    },
  },
} as const
