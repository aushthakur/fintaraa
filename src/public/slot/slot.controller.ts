// Slot Controller
import { Request, Response } from 'express';

export const createSlot = (req: Request, res: Response) => {
  res.send('Create slot');
};

export const getAllSlots = (req: Request, res: Response) => {
  res.send('Get all slots');
};

export const getSlotById = (req: Request, res: Response) => {
  res.send('Get slot by ID');
};

export const updateSlotById = (req: Request, res: Response) => {
  res.send('Update slot by ID');
};

export const deleteSlotById = (req: Request, res: Response) => {
  res.send('Delete slot by ID');
};
