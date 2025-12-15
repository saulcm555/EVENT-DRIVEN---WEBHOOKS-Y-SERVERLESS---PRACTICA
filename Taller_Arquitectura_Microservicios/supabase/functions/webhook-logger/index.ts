// ========================================
// EDGE FUNCTION: Webhook Logger
// Registra webhooks recibidos en la base de datos de Supabase
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || 'dev_secret_key_123456';

console.log('📝 Webhook Logger Edge Function iniciada');

// Función para validar firma HMAC usando Web Crypto API (seguro)
async function validateSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) {
    console.warn('⚠️ No signature provided');
    return false;
  }

  try {
    // 1. Extraer hash de la firma
    const receivedHash = signature.replace('sha256=', '');

    // 2. Calcular hash esperado usando Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(body);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      messageData
    );

    // 3. Convertir a hex
    const expectedHash = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // 4. Comparar de forma segura (timing-safe)
    return timingSafeEqual(receivedHash, expectedHash);
  } catch (error) {
    console.error('Error validating signature:', error);
    return false;
  }
}

// Comparación timing-safe para prevenir timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

// Validar timestamp para prevenir replay attacks
function validateTimestamp(timestamp: string, maxAgeMinutes: number = 5): boolean {
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp);
  
  if (isNaN(requestTime)) {
    return false;
  }

  const age = now - requestTime;

  // Verificar que no sea muy antiguo (anti-replay)
  if (age > maxAgeMinutes * 60) {
    console.warn(`⚠️ Request too old: ${age} seconds`);
    return false;
  }

  // Verificar que no sea del futuro (clock skew)
  if (age < -60) {
    console.warn(`⚠️ Request from future: ${age} seconds`);
    return false;
  }

  return true;
}

serve(async (req) => {
  // CORS Headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Manejar preflight requests (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validar método HTTP
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Crear cliente de Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Obtener el cuerpo como texto para validación HMAC
    const bodyText = await req.text();
    
    // Validar firma HMAC
    const signature = req.headers.get('X-Webhook-Signature');
    const isValidSignature = await validateSignature(bodyText, signature, WEBHOOK_SECRET);

    if (!isValidSignature) {
      console.error('❌ Invalid HMAC signature');
      return new Response(
        JSON.stringify({ 
          error: 'Invalid signature',
          message: 'Webhook signature validation failed. Ensure you are sending the X-Webhook-Signature header with a valid HMAC-SHA256 signature.'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ HMAC signature validated successfully');

    // Validar timestamp (anti-replay attack)
    const timestamp = req.headers.get('X-Webhook-Timestamp');
    if (timestamp) {
      const isValidTimestamp = validateTimestamp(timestamp, 5);
      if (!isValidTimestamp) {
        console.error('❌ Invalid timestamp - possible replay attack');
        return new Response(
          JSON.stringify({ 
            error: 'Invalid timestamp',
            message: 'Request timestamp is too old or invalid. Possible replay attack.'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('✅ Timestamp validated successfully');
    }

    // Parsear el payload del webhook
    const payload = JSON.parse(bodyText);
    console.log('📬 Webhook recibido para logging:', JSON.stringify(payload, null, 2));

    // Validar estructura del webhook
    if (!payload.event || !payload.idempotency_key) {
      return new Response(
        JSON.stringify({ error: 'Invalid webhook payload. Missing required fields.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Guardar en la tabla webhook_events_log
    const { data, error } = await supabase
      .from('webhook_events_log')
      .insert({
        event_name: payload.event,
        idempotency_key: payload.idempotency_key,
        internal_payload: payload.data || {},
        standardized_payload: payload,
        source_service: payload.metadata?.source || 'unknown',
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Error al guardar en la base de datos:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Database insert failed',
          details: error.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Webhook registrado exitosamente en la base de datos:', data.id);

    // Respuesta exitosa
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Webhook logged successfully',
        log_id: data.id,
        event: payload.event,
        timestamp: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error en Edge Function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
