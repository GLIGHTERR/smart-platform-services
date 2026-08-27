import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialPlatformSchema1700000000000 implements MigrationInterface {
  public readonly name = 'InitialPlatformSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION prevent_audit_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TABLE roles (
        id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code varchar(32) NOT NULL UNIQUE,
        name varchar(100) NOT NULL,
        description varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_roles_code CHECK (code ~ '^[a-z][a-z0-9_]*$')
      );

      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(320),
        phone varchar(32),
        password_hash varchar(255),
        display_name varchar(160) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'pending',
        email_verified_at timestamptz,
        phone_verified_at timestamptz,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_users_status CHECK (status IN ('pending', 'active', 'suspended', 'disabled')),
        CONSTRAINT chk_users_identity CHECK (email IS NOT NULL OR phone IS NOT NULL)
      );
      CREATE UNIQUE INDEX uq_users_email_normalized ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id smallint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
        granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
        granted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role_id)
      );

      CREATE TABLE owner_profiles (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        legal_name varchar(200),
        business_name varchar(200),
        tax_code varchar(64),
        address jsonb NOT NULL DEFAULT '{}'::jsonb,
        verification_status varchar(24) NOT NULL DEFAULT 'unverified',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_owner_profiles_verification CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
        CONSTRAINT chk_owner_profiles_address CHECK (jsonb_typeof(address) = 'object')
      );

      CREATE TABLE renter_profiles (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        date_of_birth date,
        occupation varchar(160),
        current_address jsonb NOT NULL DEFAULT '{}'::jsonb,
        emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_renter_profiles_address CHECK (jsonb_typeof(current_address) = 'object'),
        CONSTRAINT chk_renter_profiles_emergency CHECK (jsonb_typeof(emergency_contact) = 'object')
      );

      CREATE TABLE properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        name varchar(200) NOT NULL,
        description text,
        address jsonb NOT NULL,
        latitude numeric(9,6),
        longitude numeric(9,6),
        status varchar(24) NOT NULL DEFAULT 'draft',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_properties_status CHECK (status IN ('draft', 'active', 'inactive', 'suspended')),
        CONSTRAINT chk_properties_address CHECK (jsonb_typeof(address) = 'object'),
        CONSTRAINT chk_properties_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
        CONSTRAINT chk_properties_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
      );
      CREATE INDEX idx_properties_owner ON properties(owner_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_properties_status ON properties(status) WHERE deleted_at IS NULL;

      CREATE TABLE rooms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
        code varchar(64) NOT NULL,
        name varchar(160) NOT NULL,
        description text,
        floor varchar(32),
        area_m2 numeric(10,2),
        max_occupants smallint,
        monthly_rent numeric(14,2) NOT NULL,
        deposit_amount numeric(14,2) NOT NULL DEFAULT 0,
        currency char(3) NOT NULL DEFAULT 'VND',
        status varchar(24) NOT NULL DEFAULT 'available',
        amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT uq_rooms_property_code UNIQUE (property_id, code),
        CONSTRAINT chk_rooms_status CHECK (status IN ('available', 'reserved', 'occupied', 'maintenance', 'inactive')),
        CONSTRAINT chk_rooms_amounts CHECK (monthly_rent >= 0 AND deposit_amount >= 0),
        CONSTRAINT chk_rooms_area CHECK (area_m2 IS NULL OR area_m2 > 0),
        CONSTRAINT chk_rooms_occupants CHECK (max_occupants IS NULL OR max_occupants > 0),
        CONSTRAINT chk_rooms_amenities CHECK (jsonb_typeof(amenities) = 'array')
      );
      CREATE INDEX idx_rooms_property_status ON rooms(property_id, status) WHERE deleted_at IS NULL;

      CREATE TABLE bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        renter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        viewing_starts_at timestamptz NOT NULL,
        viewing_ends_at timestamptz NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'requested',
        renter_note text,
        decision_reason text,
        decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
        decided_at timestamptz,
        expires_at timestamptz,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_bookings_status CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'expired', 'consumed')),
        CONSTRAINT chk_bookings_viewing_window CHECK (viewing_ends_at > viewing_starts_at)
      );
      CREATE INDEX idx_bookings_room_schedule ON bookings(room_id, viewing_starts_at, viewing_ends_at) WHERE status IN ('requested', 'approved');
      CREATE INDEX idx_bookings_renter_status ON bookings(renter_id, status, created_at DESC);
      CREATE INDEX idx_bookings_owner_status ON bookings(owner_id, status, created_at DESC);

      CREATE TABLE contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
        room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        renter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status varchar(32) NOT NULL DEFAULT 'draft',
        starts_on date NOT NULL,
        ends_on date,
        monthly_rent numeric(14,2) NOT NULL,
        deposit_amount numeric(14,2) NOT NULL DEFAULT 0,
        currency char(3) NOT NULL DEFAULT 'VND',
        billing_day smallint NOT NULL,
        terms_snapshot jsonb NOT NULL,
        owner_signed_at timestamptz,
        renter_signed_at timestamptz,
        activated_at timestamptz,
        terminated_at timestamptz,
        termination_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_contracts_status CHECK (status IN ('draft', 'pending_signatures', 'active', 'terminated', 'cancelled', 'expired')),
        CONSTRAINT chk_contracts_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
        CONSTRAINT chk_contracts_amounts CHECK (monthly_rent >= 0 AND deposit_amount >= 0),
        CONSTRAINT chk_contracts_billing_day CHECK (billing_day BETWEEN 1 AND 28),
        CONSTRAINT chk_contracts_terms CHECK (jsonb_typeof(terms_snapshot) = 'object')
      );
      CREATE UNIQUE INDEX uq_contracts_active_room ON contracts(room_id) WHERE status = 'active';
      CREATE INDEX idx_contracts_renter_status ON contracts(renter_id, status);
      CREATE INDEX idx_contracts_owner_status ON contracts(owner_id, status);

      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number varchar(64) NOT NULL UNIQUE,
        contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        renter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        period_start date NOT NULL,
        period_end date NOT NULL,
        issued_at timestamptz,
        due_on date NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'draft',
        subtotal_amount numeric(14,2) NOT NULL DEFAULT 0,
        adjustment_amount numeric(14,2) NOT NULL DEFAULT 0,
        total_amount numeric(14,2) NOT NULL DEFAULT 0,
        paid_amount numeric(14,2) NOT NULL DEFAULT 0,
        outstanding_amount numeric(14,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
        currency char(3) NOT NULL DEFAULT 'VND',
        paid_at timestamptz,
        voided_at timestamptz,
        void_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_invoices_status CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void')),
        CONSTRAINT chk_invoices_period CHECK (period_end >= period_start),
        CONSTRAINT chk_invoices_amounts CHECK (subtotal_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0 AND paid_amount <= total_amount)
      );
      CREATE INDEX idx_invoices_contract_period ON invoices(contract_id, period_start, period_end);
      CREATE INDEX idx_invoices_renter_status_due ON invoices(renter_id, status, due_on);
      CREATE INDEX idx_invoices_owner_status_due ON invoices(owner_id, status, due_on);

      CREATE TABLE invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        item_type varchar(32) NOT NULL,
        description varchar(255) NOT NULL,
        quantity numeric(12,3) NOT NULL DEFAULT 1,
        unit_amount numeric(14,2) NOT NULL,
        total_amount numeric(14,2) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_invoice_items_quantity CHECK (quantity > 0),
        CONSTRAINT chk_invoice_items_amounts CHECK (unit_amount >= 0 AND total_amount >= 0),
        CONSTRAINT chk_invoice_items_metadata CHECK (jsonb_typeof(metadata) = 'object')
      );
      CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        payer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        idempotency_key varchar(128) NOT NULL UNIQUE,
        provider varchar(64) NOT NULL,
        provider_reference varchar(255),
        method varchar(32),
        status varchar(32) NOT NULL DEFAULT 'created',
        amount numeric(14,2) NOT NULL,
        currency char(3) NOT NULL DEFAULT 'VND',
        failure_code varchar(64),
        failure_message varchar(500),
        provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        expires_at timestamptz,
        success_at timestamptz,
        failed_at timestamptz,
        refunded_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_payments_status CHECK (status IN ('created', 'pending_gateway', 'success', 'failed', 'expired', 'refund_pending', 'refunded')),
        CONSTRAINT chk_payments_amount CHECK (amount > 0),
        CONSTRAINT chk_payments_metadata CHECK (jsonb_typeof(provider_metadata) = 'object')
      );
      CREATE UNIQUE INDEX uq_payments_provider_reference ON payments(provider, provider_reference) WHERE provider_reference IS NOT NULL;
      CREATE INDEX idx_payments_invoice_status ON payments(invoice_id, status, created_at DESC);
      CREATE INDEX idx_payments_payer_created ON payments(payer_id, created_at DESC);

      CREATE TABLE payment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
        provider varchar(64) NOT NULL,
        provider_event_id varchar(255) NOT NULL,
        event_type varchar(100) NOT NULL,
        payload_hash char(64) NOT NULL,
        payload jsonb NOT NULL,
        processing_status varchar(24) NOT NULL DEFAULT 'received',
        processed_at timestamptz,
        error_message varchar(500),
        received_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_payment_events_provider_event UNIQUE (provider, provider_event_id),
        CONSTRAINT chk_payment_events_status CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
        CONSTRAINT chk_payment_events_payload CHECK (jsonb_typeof(payload) = 'object')
      );
      CREATE INDEX idx_payment_events_payment ON payment_events(payment_id, received_at DESC);

      CREATE TABLE payment_allocations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
        amount numeric(14,2) NOT NULL,
        currency char(3) NOT NULL DEFAULT 'VND',
        allocated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_payment_allocations UNIQUE (invoice_id, payment_id),
        CONSTRAINT chk_payment_allocations_amount CHECK (amount > 0)
      );

      CREATE TABLE maintenance_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
        room_id uuid REFERENCES rooms(id) ON DELETE RESTRICT,
        reported_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
        title varchar(200) NOT NULL,
        description text NOT NULL,
        priority varchar(16) NOT NULL DEFAULT 'normal',
        status varchar(24) NOT NULL DEFAULT 'open',
        resolution_note text,
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_maintenance_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        CONSTRAINT chk_maintenance_status CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'cancelled'))
      );
      CREATE INDEX idx_maintenance_property_status ON maintenance_reports(property_id, status, created_at DESC);
      CREATE INDEX idx_maintenance_reporter ON maintenance_reports(reported_by, created_at DESC);

      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type varchar(100) NOT NULL,
        channel varchar(24) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'queued',
        title varchar(200) NOT NULL,
        body text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        scheduled_at timestamptz,
        sent_at timestamptz,
        read_at timestamptz,
        failed_at timestamptz,
        failure_reason varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_notifications_channel CHECK (channel IN ('in_app', 'push', 'email', 'sms')),
        CONSTRAINT chk_notifications_status CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
        CONSTRAINT chk_notifications_data CHECK (jsonb_typeof(data) = 'object')
      );
      CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, read_at, created_at DESC);
      CREATE INDEX idx_notifications_delivery_queue ON notifications(status, scheduled_at) WHERE status = 'queued';

      CREATE TABLE media_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        subject_type varchar(64),
        subject_id uuid,
        storage_provider varchar(32) NOT NULL,
        bucket varchar(128) NOT NULL,
        object_key varchar(512) NOT NULL,
        original_name varchar(255) NOT NULL,
        content_type varchar(160) NOT NULL,
        size_bytes bigint NOT NULL,
        checksum_sha256 char(64),
        visibility varchar(16) NOT NULL DEFAULT 'private',
        status varchar(24) NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT uq_media_storage_object UNIQUE (storage_provider, bucket, object_key),
        CONSTRAINT chk_media_size CHECK (size_bytes >= 0),
        CONSTRAINT chk_media_visibility CHECK (visibility IN ('public', 'private')),
        CONSTRAINT chk_media_status CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted'))
      );
      CREATE INDEX idx_media_subject ON media_files(subject_type, subject_id) WHERE deleted_at IS NULL;

      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category varchar(24) NOT NULL,
        event_type varchar(120) NOT NULL,
        actor_id uuid,
        subject_type varchar(64) NOT NULL,
        subject_id uuid,
        request_id varchar(128),
        ip_address inet,
        user_agent varchar(500),
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_audit_category CHECK (category IN ('security', 'business', 'data_change')),
        CONSTRAINT chk_audit_data CHECK (jsonb_typeof(data) = 'object')
      );
      CREATE INDEX idx_audit_subject ON audit_logs(subject_type, subject_id, occurred_at DESC);
      CREATE INDEX idx_audit_actor ON audit_logs(actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
      CREATE INDEX idx_audit_event_type ON audit_logs(event_type, occurred_at DESC);
      CREATE TRIGGER trg_audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_type varchar(64) NOT NULL,
        aggregate_id uuid NOT NULL,
        event_type varchar(120) NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        published_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        last_error varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_outbox_payload CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT chk_outbox_attempts CHECK (attempt_count >= 0)
      );
      CREATE INDEX idx_outbox_unpublished ON outbox_events(next_attempt_at, created_at) WHERE published_at IS NULL;

      CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_owner_profiles_updated_at BEFORE UPDATE ON owner_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_renter_profiles_updated_at BEFORE UPDATE ON renter_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_maintenance_updated_at BEFORE UPDATE ON maintenance_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON media_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      COMMENT ON TABLE roles IS 'identity module';
      COMMENT ON TABLE users IS 'identity module';
      COMMENT ON TABLE user_roles IS 'identity module';
      COMMENT ON TABLE owner_profiles IS 'identity module';
      COMMENT ON TABLE renter_profiles IS 'identity module';
      COMMENT ON TABLE properties IS 'property module';
      COMMENT ON TABLE rooms IS 'property module';
      COMMENT ON TABLE bookings IS 'booking module';
      COMMENT ON TABLE contracts IS 'contract module';
      COMMENT ON TABLE invoices IS 'billing module';
      COMMENT ON TABLE invoice_items IS 'billing module';
      COMMENT ON TABLE payment_allocations IS 'billing module; written only through BillingPaymentService';
      COMMENT ON TABLE payments IS 'payment module';
      COMMENT ON TABLE payment_events IS 'payment module; provider webhook idempotency inbox';
      COMMENT ON TABLE audit_logs IS 'audit module; append-only';
      COMMENT ON TABLE outbox_events IS 'cross-module transactional event delivery';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS outbox_events;
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS media_files;
      DROP TABLE IF EXISTS notifications;
      DROP TABLE IF EXISTS maintenance_reports;
      DROP TABLE IF EXISTS payment_allocations;
      DROP TABLE IF EXISTS payment_events;
      DROP TABLE IF EXISTS payments;
      DROP TABLE IF EXISTS invoice_items;
      DROP TABLE IF EXISTS invoices;
      DROP TABLE IF EXISTS contracts;
      DROP TABLE IF EXISTS bookings;
      DROP TABLE IF EXISTS rooms;
      DROP TABLE IF EXISTS properties;
      DROP TABLE IF EXISTS renter_profiles;
      DROP TABLE IF EXISTS owner_profiles;
      DROP TABLE IF EXISTS user_roles;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS roles;
      DROP FUNCTION IF EXISTS prevent_audit_mutation();
      DROP FUNCTION IF EXISTS set_updated_at();
    `);
  }
}
