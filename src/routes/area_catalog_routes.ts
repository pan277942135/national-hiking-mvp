import type { Express, Request, Response } from 'express';
import {
  CatalogEntityType,
  getAreaCatalogSummary,
  getCatalogEntity,
  listAreaCatalog,
  parseCatalogState
} from '../services/area_catalog_service.js';

function catalogErrorStatus(message: string): number {
  if (message.includes('Invalid catalog_state') || message.includes('required')) return 400;
  if (message.includes('not configured')) return 503;
  return 500;
}

async function handleAreaList(
  req: Request,
  res: Response,
  entityType: CatalogEntityType,
  responseKey: string
) {
  try {
    const state = parseCatalogState(req.query.state);
    const includeDeprecated = req.query.include_deprecated === 'true';
    const records = await listAreaCatalog(req.params.areaId, entityType, {
      state,
      includeDeprecated
    });
    res.json({
      area_id: req.params.areaId,
      entity_type: entityType,
      count: records.length,
      [responseKey]: records
    });
  } catch (error) {
    const message = (error as Error).message;
    res.status(catalogErrorStatus(message)).json({ error: message });
  }
}

export function mountAreaCatalogRoutes(app: Express) {
  app.get('/areas/:areaId/catalog', async (req, res) => {
    try {
      res.json(await getAreaCatalogSummary(req.params.areaId));
    } catch (error) {
      const message = (error as Error).message;
      res.status(catalogErrorStatus(message)).json({ error: message });
    }
  });

  app.get('/areas/:areaId/access-points', (req, res) =>
    handleAreaList(req, res, 'ACCESS_POINT', 'access_points'));

  app.get('/areas/:areaId/pois', (req, res) =>
    handleAreaList(req, res, 'POI', 'pois'));

  app.get('/areas/:areaId/parking', (req, res) =>
    handleAreaList(req, res, 'PARKING', 'parking'));

  app.get('/catalog/access-points/:id', async (req, res) => {
    try {
      const record = await getCatalogEntity('ACCESS_POINT', req.params.id);
      if (!record) return res.status(404).json({ error: `AccessPoint not found: ${req.params.id}` });
      return res.json(record);
    } catch (error) {
      const message = (error as Error).message;
      return res.status(catalogErrorStatus(message)).json({ error: message });
    }
  });

  app.get('/catalog/pois/:id', async (req, res) => {
    try {
      const record = await getCatalogEntity('POI', req.params.id);
      if (!record) return res.status(404).json({ error: `POI not found: ${req.params.id}` });
      return res.json(record);
    } catch (error) {
      const message = (error as Error).message;
      return res.status(catalogErrorStatus(message)).json({ error: message });
    }
  });

  app.get('/catalog/parking/:id', async (req, res) => {
    try {
      const record = await getCatalogEntity('PARKING', req.params.id);
      if (!record) return res.status(404).json({ error: `Parking not found: ${req.params.id}` });
      return res.json(record);
    } catch (error) {
      const message = (error as Error).message;
      return res.status(catalogErrorStatus(message)).json({ error: message });
    }
  });
}
