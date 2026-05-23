export type Profile = {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
} & Record<string, unknown>;

export type Veiculo = {
  id: string;
  user_id: string;
  nome_anuncio: string;
  quilometragem: string;
  motor: string;
  valor: number;
  cor: string;
  fipe: string;
  placa: string;
  tipo: string;
  texto_anuncio: string;
  imagens: string[];
  status: string;
  lote_id: string | null;
  posicao_lote: number;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type Lote = {
  id: string;
  user_id: string;
  nome: string;
  lote_da_vez: boolean;
  created_at: string;
} & Record<string, unknown>;

export type IdDosGrupos = {
  id: string;
  user_id: string;
  nome_do_grupo: string;
  id_do_grupo: string | null;
  status: string;
  created_at: string;
} & Record<string, unknown>;

export type AnuncioGrupo = {
  id: string;
  veiculo_id: string;
  grupo_id: string;
  user_id: string;
  programado: boolean;
  programado_em: string | null;
  created_at: string;
} & Record<string, unknown>;

export type WhatsappInstancia = {
  id: string;
  user_id: string;
  nome: string;
  token: string;
  status: string;
  created_at: string;
} & Record<string, unknown>;

export type LogAuditoria = {
  id: string;
  user_email: string;
  user_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  detalhes: Record<string, unknown> | unknown[] | string | number | boolean | null;
  created_at: string;
} & Record<string, unknown>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          email: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: Partial<Profile>;
        Relationships: [];
      };
      veiculos: {
        Row: Veiculo;
        Insert: Omit<Veiculo, "id" | "created_at" | "updated_at" | "status"> & {
          id?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Veiculo, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      id_dos_grupos: {
        Row: IdDosGrupos;
        Insert: Omit<IdDosGrupos, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<IdDosGrupos, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      anuncio_grupos: {
        Row: AnuncioGrupo;
        Insert: Omit<AnuncioGrupo, "id" | "created_at" | "programado"> & {
          id?: string;
          programado?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<AnuncioGrupo, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      lotes: {
        Row: Lote;
        Insert: Omit<Lote, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Lote, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      whatsapp_instancias: {
        Row: WhatsappInstancia;
        Insert: Omit<WhatsappInstancia, "id" | "created_at" | "status"> & {
          id?: string;
          status?: string;
          created_at?: string;
        };
        Update: Partial<Omit<WhatsappInstancia, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      logs_auditoria: {
        Row: LogAuditoria;
        Insert: Omit<LogAuditoria, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<LogAuditoria, "id" | "created_at">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
