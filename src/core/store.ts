// Sauvegarde. Une seule interface : stockage du téléphone aujourd'hui, Supabase à l'étape en ligne.
export interface Save { version: 1; visited: string[]; last?: [number, number] }
export interface SaveStore { load(): Promise<Save>; save(s: Save): Promise<void> }
export const emptySave = (): Save => ({ version: 1, visited: [] });

export class LocalStore implements SaveStore {
  constructor(private key = 'dernier-relais/save') {}
  async load(): Promise<Save> {
    try { const s = JSON.parse(localStorage.getItem(this.key) ?? 'null'); if (s?.version === 1) return s; } catch { /* stockage indisponible */ }
    return emptySave();
  }
  async save(s: Save): Promise<void> {
    try { localStorage.setItem(this.key, JSON.stringify(s)); } catch { /* stockage indisponible */ }
  }
}
