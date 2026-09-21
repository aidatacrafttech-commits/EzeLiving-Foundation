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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: number | null
          entity_type: string
          id: number
          metadata: Json | null
          user_id: number
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: number | null
          entity_type: string
          id?: number
          metadata?: Json | null
          user_id: number
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: number | null
          entity_type?: string
          id?: number
          metadata?: Json | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          discount_percent: number
          id: number
          is_active: boolean
        }
        Insert: {
          code: string
          created_at?: string
          discount_percent: number
          id?: number
          is_active?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          discount_percent?: number
          id?: number
          is_active?: boolean
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          gst_number: string | null
          id: number
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          gst_number?: string | null
          id?: number
          name: string
          phone?: string | null
          updated_at: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          gst_number?: string | null
          id?: number
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_counters: {
        Row: {
          document_type: string
          last_number: number
          year: number
        }
        Insert: {
          document_type: string
          last_number?: number
          year: number
        }
        Update: {
          document_type?: string
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      generated_barcodes: {
        Row: {
          assigned_at: string | null
          assigned_product_id: number | null
          code: string
          created_at: string
          created_by_id: number | null
          id: number
          status: Database["public"]["Enums"]["GeneratedBarcodeStatus"]
        }
        Insert: {
          assigned_at?: string | null
          assigned_product_id?: number | null
          code: string
          created_at?: string
          created_by_id?: number | null
          id?: number
          status?: Database["public"]["Enums"]["GeneratedBarcodeStatus"]
        }
        Update: {
          assigned_at?: string | null
          assigned_product_id?: number | null
          code?: string
          created_at?: string
          created_by_id?: number | null
          id?: number
          status?: Database["public"]["Enums"]["GeneratedBarcodeStatus"]
        }
        Relationships: [
          {
            foreignKeyName: "generated_barcodes_assigned_product_id_fkey"
            columns: ["assigned_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_barcodes_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hold_invoice_items: {
        Row: {
          hold_invoice_id: number
          id: number
          kept_qty: number
          mrp: number
          price: number
          product_id: number
          qty: number
          returned_damaged_qty: number
          returned_normal_qty: number
          tax_percent: number
        }
        Insert: {
          hold_invoice_id: number
          id?: number
          kept_qty?: number
          mrp: number
          price: number
          product_id: number
          qty: number
          returned_damaged_qty?: number
          returned_normal_qty?: number
          tax_percent: number
        }
        Update: {
          hold_invoice_id?: number
          id?: number
          kept_qty?: number
          mrp?: number
          price?: number
          product_id?: number
          qty?: number
          returned_damaged_qty?: number
          returned_normal_qty?: number
          tax_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "hold_invoice_items_hold_invoice_id_fkey"
            columns: ["hold_invoice_id"]
            isOneToOne: false
            referencedRelation: "hold_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      hold_invoices: {
        Row: {
          created_at: string
          created_by_id: number | null
          customer_id: number | null
          expires_at: string
          hold_number: string
          id: number
          processed_at: string | null
          status: Database["public"]["Enums"]["HoldStatus"]
          warehouse_id: number
        }
        Insert: {
          created_at?: string
          created_by_id?: number | null
          customer_id?: number | null
          expires_at: string
          hold_number: string
          id?: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["HoldStatus"]
          warehouse_id: number
        }
        Update: {
          created_at?: string
          created_by_id?: number | null
          customer_id?: number | null
          expires_at?: string
          hold_number?: string
          id?: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["HoldStatus"]
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "hold_invoices_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hold_invoices_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          barcode_scanned: string | null
          discount: number
          id: number
          invoice_id: number
          line_total: number
          mrp: number
          price: number
          product_id: number
          qty: number
          returned_qty: number
          tax_amount: number
        }
        Insert: {
          barcode_scanned?: string | null
          discount?: number
          id?: number
          invoice_id: number
          line_total: number
          mrp: number
          price: number
          product_id: number
          qty: number
          returned_qty?: number
          tax_amount: number
        }
        Update: {
          barcode_scanned?: string | null
          discount?: number
          id?: number
          invoice_id?: number
          line_total?: number
          mrp?: number
          price?: number
          product_id?: number
          qty?: number
          returned_qty?: number
          tax_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          coupon_code: string | null
          coupon_discount_amount: number | null
          coupon_discount_percent: number | null
          created_at: string
          created_by_id: number | null
          customer_address_snapshot: string | null
          customer_gst_snapshot: string | null
          customer_id: number | null
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          grand_total: number
          hold_invoice_id: number | null
          id: number
          idempotency_key: string | null
          invoice_number: string
          packaging_charge: number
          payment_mode: Database["public"]["Enums"]["PaymentMode"]
          status: Database["public"]["Enums"]["InvoiceStatus"]
          subtotal: number
          tax_amount: number
          transport_charge: number
          warehouse_id: number
          warehouse_location_snapshot: string | null
          warehouse_name_snapshot: string | null
        }
        Insert: {
          coupon_code?: string | null
          coupon_discount_amount?: number | null
          coupon_discount_percent?: number | null
          created_at?: string
          created_by_id?: number | null
          customer_address_snapshot?: string | null
          customer_gst_snapshot?: string | null
          customer_id?: number | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          grand_total: number
          hold_invoice_id?: number | null
          id?: number
          idempotency_key?: string | null
          invoice_number: string
          packaging_charge?: number
          payment_mode: Database["public"]["Enums"]["PaymentMode"]
          status?: Database["public"]["Enums"]["InvoiceStatus"]
          subtotal: number
          tax_amount: number
          transport_charge?: number
          warehouse_id: number
          warehouse_location_snapshot?: string | null
          warehouse_name_snapshot?: string | null
        }
        Update: {
          coupon_code?: string | null
          coupon_discount_amount?: number | null
          coupon_discount_percent?: number | null
          created_at?: string
          created_by_id?: number | null
          customer_address_snapshot?: string | null
          customer_gst_snapshot?: string | null
          customer_id?: number | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          grand_total?: number
          hold_invoice_id?: number | null
          id?: number
          idempotency_key?: string | null
          invoice_number?: string
          packaging_charge?: number
          payment_mode?: Database["public"]["Enums"]["PaymentMode"]
          status?: Database["public"]["Enums"]["InvoiceStatus"]
          subtotal?: number
          tax_amount?: number
          transport_charge?: number
          warehouse_id?: number
          warehouse_location_snapshot?: string | null
          warehouse_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_hold_invoice_id_fkey"
            columns: ["hold_invoice_id"]
            isOneToOne: false
            referencedRelation: "hold_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string
          brand: string | null
          category: string | null
          created_at: string
          id: number
          image_data: string | null
          image_url: string | null
          is_active: boolean
          mrp: number
          name: string
          selling_price: number
          sku: string
          tax_percent: number
          unit: string
          updated_at: string
        }
        Insert: {
          barcode: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: number
          image_data?: string | null
          image_url?: string | null
          is_active?: boolean
          mrp: number
          name: string
          selling_price: number
          sku: string
          tax_percent?: number
          unit?: string
          updated_at: string
        }
        Update: {
          barcode?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: number
          image_data?: string | null
          image_url?: string | null
          is_active?: boolean
          mrp?: number
          name?: string
          selling_price?: number
          sku?: string
          tax_percent?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          cost_price: number
          damaged_qty: number
          id: number
          line_total: number
          product_id: number
          purchase_id: number
          qty: number
          warehouse_id: number
        }
        Insert: {
          cost_price: number
          damaged_qty?: number
          id?: number
          line_total: number
          product_id: number
          purchase_id: number
          qty: number
          warehouse_id: number
        }
        Update: {
          cost_price?: number
          damaged_qty?: number
          id?: number
          line_total?: number
          product_id?: number
          purchase_id?: number
          qty?: number
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by_id: number | null
          id: number
          purchase_number: string
          supplier_id: number | null
          total_amount: number
        }
        Insert: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          purchase_number: string
          supplier_id?: number | null
          total_amount: number
        }
        Update: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          purchase_number?: string
          supplier_id?: number | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          id: number
          invoice_item_id: number
          product_id: number
          qty: number
          reason: Database["public"]["Enums"]["ReturnReason"]
          refund_amount: number
          return_id: number
        }
        Insert: {
          id?: number
          invoice_item_id: number
          product_id: number
          qty: number
          reason: Database["public"]["Enums"]["ReturnReason"]
          refund_amount: number
          return_id: number
        }
        Update: {
          id?: number
          invoice_item_id?: number
          product_id?: number
          qty?: number
          reason?: Database["public"]["Enums"]["ReturnReason"]
          refund_amount?: number
          return_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_items_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          created_at: string
          created_by_id: number | null
          id: number
          invoice_id: number
          return_number: string
          total_refund: number
        }
        Insert: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          invoice_id: number
          return_number: string
          total_refund: number
        }
        Update: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          invoice_id?: number
          return_number?: string
          total_refund?: number
        }
        Relationships: [
          {
            foreignKeyName: "returns_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      stock: {
        Row: {
          damaged_quantity: number
          damaged_quantity_transit: number
          id: number
          product_id: number
          quantity: number
          reorder_level: number
          updated_at: string
          warehouse_id: number
        }
        Insert: {
          damaged_quantity?: number
          damaged_quantity_transit?: number
          id?: number
          product_id: number
          quantity?: number
          reorder_level?: number
          updated_at: string
          warehouse_id: number
        }
        Update: {
          damaged_quantity?: number
          damaged_quantity_transit?: number
          id?: number
          product_id?: number
          quantity?: number
          reorder_level?: number
          updated_at?: string
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          balance_qty: number
          change_qty: number
          created_at: string
          id: number
          performed_by_id: number | null
          previous_qty: number
          product_id: number
          reason: string | null
          reference_id: number | null
          reference_type: Database["public"]["Enums"]["LedgerReferenceType"]
          warehouse_id: number
        }
        Insert: {
          balance_qty: number
          change_qty: number
          created_at?: string
          id?: number
          performed_by_id?: number | null
          previous_qty: number
          product_id: number
          reason?: string | null
          reference_id?: number | null
          reference_type: Database["public"]["Enums"]["LedgerReferenceType"]
          warehouse_id: number
        }
        Update: {
          balance_qty?: number
          change_qty?: number
          created_at?: string
          id?: number
          performed_by_id?: number | null
          previous_qty?: number
          product_id?: number
          reason?: string | null
          reference_id?: number | null
          reference_type?: Database["public"]["Enums"]["LedgerReferenceType"]
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_performed_by_id_fkey"
            columns: ["performed_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          from_new_qty: number
          from_previous_qty: number
          from_warehouse_id: number
          id: number
          performed_by_id: number | null
          product_id: number
          qty: number
          reason: string | null
          to_new_qty: number
          to_previous_qty: number
          to_warehouse_id: number
        }
        Insert: {
          created_at?: string
          from_new_qty: number
          from_previous_qty: number
          from_warehouse_id: number
          id?: number
          performed_by_id?: number | null
          product_id: number
          qty: number
          reason?: string | null
          to_new_qty: number
          to_previous_qty: number
          to_warehouse_id: number
        }
        Update: {
          created_at?: string
          from_new_qty?: number
          from_previous_qty?: number
          from_warehouse_id?: number
          id?: number
          performed_by_id?: number | null
          product_id?: number
          qty?: number
          reason?: string | null
          to_new_qty?: number
          to_previous_qty?: number
          to_warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_performed_by_id_fkey"
            columns: ["performed_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_return_items: {
        Row: {
          id: number
          product_id: number
          qty: number
          supplier_return_id: number
        }
        Insert: {
          id?: number
          product_id: number
          qty: number
          supplier_return_id: number
        }
        Update: {
          id?: number
          product_id?: number
          qty?: number
          supplier_return_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_return_items_supplier_return_id_fkey"
            columns: ["supplier_return_id"]
            isOneToOne: false
            referencedRelation: "supplier_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_returns: {
        Row: {
          created_at: string
          created_by_id: number | null
          id: number
          return_number: string
          supplier_id: number | null
          warehouse_id: number
        }
        Insert: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          return_number: string
          supplier_id?: number | null
          warehouse_id: number
        }
        Update: {
          created_at?: string
          created_by_id?: number | null
          id?: number
          return_number?: string
          supplier_id?: number | null
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_returns_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          email: string | null
          id: number
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          email?: string | null
          id?: number
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          email?: string | null
          id?: number
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: number
          is_active: boolean
          last_login_at: string | null
          name: string
          password_hash: string
          role: Database["public"]["Enums"]["UserRole"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
          is_active?: boolean
          last_login_at?: string | null
          name: string
          password_hash: string
          role?: Database["public"]["Enums"]["UserRole"]
          updated_at: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
          is_active?: boolean
          last_login_at?: string | null
          name?: string
          password_hash?: string
          role?: Database["public"]["Enums"]["UserRole"]
          updated_at?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          contact_person: string | null
          id: number
          is_active: boolean
          location: string | null
          name: string
          phone: string | null
        }
        Insert: {
          contact_person?: string | null
          id?: number
          is_active?: boolean
          location?: string | null
          name: string
          phone?: string | null
        }
        Update: {
          contact_person?: string | null
          id?: number
          is_active?: boolean
          location?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      GeneratedBarcodeStatus: "unused" | "assigned"
      HoldStatus: "active" | "completed" | "returned" | "expired"
      InvoiceStatus: "draft" | "paid" | "cancelled"
      LedgerReferenceType:
        | "invoice"
        | "purchase"
        | "adjustment"
        | "return"
        | "transfer"
        | "hold"
      PaymentMode: "cash" | "card" | "upi"
      ReturnReason: "normal" | "defective"
      UserRole: "admin" | "staff"
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
      GeneratedBarcodeStatus: ["unused", "assigned"],
      HoldStatus: ["active", "completed", "returned", "expired"],
      InvoiceStatus: ["draft", "paid", "cancelled"],
      LedgerReferenceType: [
        "invoice",
        "purchase",
        "adjustment",
        "return",
        "transfer",
        "hold",
      ],
      PaymentMode: ["cash", "card", "upi"],
      ReturnReason: ["normal", "defective"],
      UserRole: ["admin", "staff"],
    },
  },
} as const
