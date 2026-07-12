import { createClient } from '@supabase/supabase-js'

// Fallbacks placeholder para que el build estático no falle cuando las
// variables no están definidas (en Vercel/local sí lo están).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
