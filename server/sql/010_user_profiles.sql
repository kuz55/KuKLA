CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name text,
  birth_date date,
  city text,
  district text,
  extra_phone text,
  medical_notes text,
  skills text[] NOT NULL DEFAULT '{}',
  has_transport boolean NOT NULL DEFAULT false,
  available_for_searches boolean NOT NULL DEFAULT true,
  emergency_contact_name text,
  emergency_contact_phone text,
  consent_personal_data boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
