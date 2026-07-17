declare module "@supabase/supabase-js" {
  export function createClient(url: string, key: string): SupabaseClient;

  export interface SupabaseClient {
    storage: {
      from(bucket: string): {
        upload(path: string, body: any, options?: any): Promise<{ error: any }>;
        getPublicUrl(path: string): { data: { publicUrl: string | null }; error: any };
      };
    };
  }
}
