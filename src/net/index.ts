// Point d'entrée du jeu en ligne. Branchement type dans src/main.ts :
//
//   import { createOnline } from './net';
//   const { store, net } = createOnline(new LocalGameStore());
//   const game = new Game({ store });            // au lieu de new Game({ store: new LocalGameStore() })
//   net.start();
//   game.on(e => { if (e.type === 'delivery') { const s = view?.shelters.find(x => x.id === e.result.shelterId); if (s) net.onDelivery(e.result, s); } });
//   // à la fermeture de la page, après game.flush() :  void store.flush();
//
// Tant que le serveur n'est pas prêt (tables absentes, connexion anonyme désactivée) ou sans réseau,
// le jeu se comporte exactement comme avec la seule sauvegarde locale.
import type { GameStore } from '../game/save';
import { NetClient } from './client';
import { CloudGameStore } from './cloudstore';
import { Network } from './network';

export { NetClient } from './client';
export { CloudGameStore } from './cloudstore';
export * from './network';
export { REGIONS, regionAt, regionName, type RegionId } from './regions';

/** Crée le client partagé, le réseau et la sauvegarde en ligne qui enveloppe la sauvegarde locale. */
export function createOnline(local: GameStore): { client: NetClient; net: Network; store: CloudGameStore } {
  const client = new NetClient();
  const net = new Network(client);
  const store = new CloudGameStore(local, client, { onSave: s => net.observeSave(s) });
  return { client, net, store };
}
