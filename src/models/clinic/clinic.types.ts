export type ClinicService = {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
};

export type ClinicProfessional = {
  id: string;
  name: string;
  specialty?: string | null;
};

export type ClinicSlot = {
  id: string;
  professionalId: string;
  professionalName: string;
  serviceId: string;
  serviceName: string;
  start: string;
  end: string;
};

export type ClinicAppointment = {
  id: string;
  status: string;
  start: string;
  end: string;
  startLabel?: string;
  professional: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number };
  patient: { phone: string; name: string | null };
};

export interface ClinicClient {
  listServices(): Promise<ClinicService[]>;
  listProfessionals(serviceId?: string): Promise<ClinicProfessional[]>;
  getAvailability(input: {
    serviceId: string;
    professionalId?: string;
    days?: number;
  }): Promise<ClinicSlot[]>;
  book(input: {
    phone: string;
    patientName?: string;
    serviceId: string;
    professionalId: string;
    start: string;
  }): Promise<ClinicAppointment>;
  listAppointments(phone: string): Promise<ClinicAppointment[]>;
  cancel(id: string, phone: string): Promise<ClinicAppointment>;
  reschedule(input: {
    id: string;
    phone: string;
    start: string;
    professionalId?: string;
  }): Promise<ClinicAppointment>;
}
