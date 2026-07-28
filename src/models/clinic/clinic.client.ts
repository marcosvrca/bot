import { env } from "../../config/env.js";
import type {
  ClinicAppointment,
  ClinicClient,
  ClinicProfessional,
  ClinicService,
  ClinicSlot,
} from "./clinic.types.js";

export class ClinicHttpClient implements ClinicClient {
  private baseUrl(): string {
    return env().CLINIC_API_URL.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": env().CLINIC_API_KEY,
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      items?: unknown;
      slots?: unknown;
    };
    if (!response.ok) {
      throw new Error(body.error ?? `Clinic API ${response.status}`);
    }
    return body as T;
  }

  async listServices(): Promise<ClinicService[]> {
    const data = await this.request<{ items: ClinicService[] }>("/v1/services");
    return data.items;
  }

  async listProfessionals(serviceId?: string): Promise<ClinicProfessional[]> {
    const qs = serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : "";
    const data = await this.request<{ items: ClinicProfessional[] }>(
      `/v1/professionals${qs}`,
    );
    return data.items;
  }

  async getAvailability(input: {
    serviceId: string;
    professionalId?: string;
    days?: number;
  }): Promise<ClinicSlot[]> {
    const params = new URLSearchParams({
      serviceId: input.serviceId,
      days: String(input.days ?? 14),
    });
    if (input.professionalId) {
      params.set("professionalId", input.professionalId);
    }
    const data = await this.request<{ slots: ClinicSlot[] }>(
      `/v1/availability?${params.toString()}`,
    );
    return data.slots;
  }

  async book(input: {
    phone: string;
    patientName?: string;
    serviceId: string;
    professionalId: string;
    start: string;
  }): Promise<ClinicAppointment> {
    return this.request<ClinicAppointment>("/v1/appointments", {
      method: "POST",
      body: JSON.stringify({ ...input, source: "whatsapp" }),
    });
  }

  async listAppointments(phone: string): Promise<ClinicAppointment[]> {
    const data = await this.request<{ items: ClinicAppointment[] }>(
      `/v1/appointments?phone=${encodeURIComponent(phone)}`,
    );
    return data.items;
  }

  async cancel(id: string, phone: string): Promise<ClinicAppointment> {
    return this.request<ClinicAppointment>(`/v1/appointments/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  }

  async reschedule(input: {
    id: string;
    phone: string;
    start: string;
    professionalId?: string;
  }): Promise<ClinicAppointment> {
    return this.request<ClinicAppointment>(
      `/v1/appointments/${input.id}/reschedule`,
      {
        method: "POST",
        body: JSON.stringify({
          phone: input.phone,
          start: input.start,
          professionalId: input.professionalId,
        }),
      },
    );
  }
}
