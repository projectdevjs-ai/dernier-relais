// Position du joueur : GPS réel, ou mode simulé (toucher la carte) quand le GPS est refusé ou absent.
export type Fix = { lng: number; lat: number; acc: number | null; source: 'gps' | 'simulé' };

export class Locator {
  private watch: number | null = null;
  constructor(private onFix: (f: Fix) => void, private onState: (s: 'gps' | 'simulé', why?: string) => void) {}
  startGPS(): void {
    if (!('geolocation' in navigator)) return this.onState('simulé', 'GPS absent sur cet appareil');
    this.stop();
    this.watch = navigator.geolocation.watchPosition(
      p => { this.onState('gps'); this.onFix({ lng: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy, source: 'gps' }); },
      e => { this.stop(); this.onState('simulé', e.code === 1 ? 'GPS refusé' : 'GPS indisponible'); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }
  simulate(lng: number, lat: number): void { this.stop(); this.onState('simulé'); this.onFix({ lng, lat, acc: null, source: 'simulé' }); }
  private stop(): void { if (this.watch !== null) { navigator.geolocation.clearWatch(this.watch); this.watch = null; } }
}
