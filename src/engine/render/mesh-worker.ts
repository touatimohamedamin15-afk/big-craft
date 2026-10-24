import { serveMesher, type MesherRequest } from './chunk-mesher'

/**
 * The chunk renderer's worker: keeps its own world and sunlight, applies the
 * page's edits, and posts meshes back as transferred typed arrays.
 */
const receive = serveMesher((result, transfer) => postMessage(result, { transfer }))
self.onmessage = (e: MessageEvent<MesherRequest>) => receive(e.data)
