import type { Express } from 'express';
import { projectAreaPage } from '../services/area_page_projection_service.js';

export function mountPageFactoryRoutes(app: Express) {
  app.get('/page-factory/areas/:areaKey', async (req, res) => {
    try {
      const projection = await projectAreaPage(req.params.areaKey);
      res.json(projection);
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith('Area not found:')) {
        return res.status(404).json({ error: message });
      }
      if (message.includes('required')) {
        return res.status(400).json({ error: message });
      }
      if (message.includes('not configured')) {
        return res.status(503).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  });
}
