import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read arguments
const moduleName = process.argv[2];
const target = process.argv[3]; // "admin" or "public"

if (!moduleName || !target || !["admin", "public"].includes(target)) {
  console.log(
    `❌ Please provide a module name and target (admin/public).\nUsage: node dist/generateModule.js <moduleName> <admin|public>`
  );
  process.exit(1);
}

const lowerName = moduleName.toLowerCase();
const capitalName = lowerName.charAt(0).toUpperCase() + lowerName.slice(1);

// Paths
const targetBase = join(__dirname, target, lowerName); // admin/user or public/user
const modelPath = join(__dirname, "modals");
const modelFile = join(modelPath, `${lowerName}.model.ts`);

const controllerFile = join(targetBase, `${lowerName}.controller.ts`);
const routeFile = join(targetBase, `${lowerName}.routes.ts`);

// Create folders if not exists
fs.mkdirSync(targetBase, { recursive: true });
fs.mkdirSync(modelPath, { recursive: true });

// Controller content
const controllerContent = `// ${capitalName} Controller
import { Request, Response } from 'express';

export const create${capitalName} = (req: Request, res: Response) => {
  res.send('Create ${lowerName}');
};

export const getAll${capitalName}s = (req: Request, res: Response) => {
  res.send('Get all ${lowerName}s');
};

export const get${capitalName}ById = (req: Request, res: Response) => {
  res.send('Get ${lowerName} by ID');
};

export const update${capitalName}ById = (req: Request, res: Response) => {
  res.send('Update ${lowerName} by ID');
};

export const delete${capitalName}ById = (req: Request, res: Response) => {
  res.send('Delete ${lowerName} by ID');
};
`;

// Route content
const routeContent = `// ${capitalName} Routes
import express from "express";
import {
  create${capitalName},
  getAll${capitalName}s,
  get${capitalName}ById,
  update${capitalName}ById,
  delete${capitalName}ById,
} from "./${lowerName}.controller";

const router = express.Router();

router
  .post("/", create${capitalName})
  .get("/", getAll${capitalName}s)
  .get("/:id", get${capitalName}ById)
  .put("/:id", update${capitalName}ById)
  .delete("/:id", delete${capitalName}ById);

export default router;
`;

// Model content
const modelContent = `// ${capitalName} Model
export interface ${capitalName} {
  id: string;
  name: string;
}
`;

// Write files
fs.writeFileSync(controllerFile, controllerContent, "utf-8");
console.log(`✅ Created: ${controllerFile}`);

fs.writeFileSync(routeFile, routeContent, "utf-8");
console.log(`✅ Created: ${routeFile}`);

fs.writeFileSync(modelFile, modelContent, "utf-8");
console.log(`✅ Created: ${modelFile}`);
