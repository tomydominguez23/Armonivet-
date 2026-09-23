/** `gpt-5.6` en Responses API enruta a Sol; Génesis usa Luna. */
export function resolveModel(raw?: string | null) {
  const model = String(raw || "").trim();
  if (!model || model === "gpt-5.6") return "gpt-5.6-luna";
  return model;
}

export type GenesisTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export const GENESIS_TOOLS: GenesisTool[] = [
  {
    type: "function",
    name: "buscar_cliente",
    description: "Busca cliente por teléfono o nombre.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "actualizar_lead",
    description: "Actualiza el pipeline del lead/conversación.",
    parameters: {
      type: "object",
      properties: {
        pipeline: {
          type: "string",
          description:
            "nuevo, contactado, calificado, quiere_agendar, esperando_pago, pagado, agendado, atendido, seguimiento, control, no_responde, cancelado, perdido, derivado_humano",
        },
        notes: { type: "string" },
      },
      required: ["pipeline", "notes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "actualizar_mascota",
    description: "Guarda o actualiza datos de la mascota del cliente.",
    parameters: {
      type: "object",
      properties: {
        pet_name: { type: "string" },
        pet_type: { type: "string", description: "perro, gato u otro" },
        pet_age: { type: "string" },
        consultation_reason: { type: "string" },
      },
      required: ["pet_name", "pet_type", "pet_age", "consultation_reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "listar_servicios",
    description: "Lista servicios y precios vigentes de Armonivet.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "consultar_disponibilidad",
    description: "Devuelve horarios libres reales de la agenda Armonivet (misma que la web). Timezone Chile. Ofrece 2 opciones concretas; no inventes horas.",
    parameters: {
      type: "object",
      properties: { days: { type: "number" } },
      required: ["days"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "crear_cita",
    description: "Crea una cita provisional solo si scheduled_at salió de consultar_disponibilidad. El abono confirma.",
    parameters: {
      type: "object",
      properties: {
        scheduled_at: { type: "string", description: "ISO 8601" },
        service_title: { type: "string" },
        amount: { type: "number" },
      },
      required: ["scheduled_at", "service_title", "amount"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "reagendar_cita",
    description: "Cambia la fecha de una cita existente.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        scheduled_at: { type: "string" },
        motivo: { type: "string" },
      },
      required: ["appointment_id", "scheduled_at", "motivo"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "cancelar_cita",
    description: "Cancela una cita.",
    parameters: {
      type: "object",
      properties: { appointment_id: { type: "string" }, motivo: { type: "string" } },
      required: ["appointment_id", "motivo"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "crear_pago",
    description: "Crea un abono pendiente y devuelve el link de pago si está configurado.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        amount: { type: "number" },
        kind: { type: "string", description: "abono o saldo" },
      },
      required: ["appointment_id", "amount", "kind"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "consultar_pago",
    description: "Consulta el estado de pagos del cliente.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "programar_recordatorio",
    description: "Programa un mensaje futuro de Génesis.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        scheduled_at: { type: "string" },
        body: { type: "string" },
      },
      required: ["kind", "scheduled_at", "body"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "escalar_a_humano",
    description: "Pausa Génesis y deja la conversación para la Dra. Bárbara.",
    parameters: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function runOpenAI(params: {
  model: string;
  instructions: string;
  input: unknown[];
  tools?: GenesisTool[];
}) {
  const key = Deno.env.get("OPENAI_API_KEY") || "";
  if (!key) throw new Error("Falta OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      instructions: params.instructions,
      input: params.input,
      tools: params.tools || [],
      store: false,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = String(data.error?.message || data.error?.code || `OpenAI ${res.status}`);
    if (res.status === 429 || /insufficient_quota|no credits remaining|exceeded your current quota/i.test(msg)) {
      throw new Error(
        "OpenAI no tiene créditos. Cargá saldo en https://platform.openai.com/settings/organization/billing y volvé a simular.",
      );
    }
    if (/invalid api key|incorrect api key/i.test(msg)) {
      throw new Error("OPENAI_API_KEY inválida. Revisala en Supabase → Edge Functions → Secrets.");
    }
    throw new Error(msg);
  }
  return data;
}

export function outputText(response: { output?: Array<Record<string, unknown>>; output_text?: string }) {
  if (response.output_text) return String(response.output_text);
  const texts: string[] = [];
  for (const item of response.output || []) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (part.type === "output_text" && part.text) texts.push(String(part.text));
      }
    }
  }
  return texts.join("\n").trim();
}
