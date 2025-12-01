import Admin from "../../modals/admin.model";
import Lander from "../../modals/lander.model";
import Agent from "../../modals/agent.model";
import { config } from "../../config/config";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { Request, Response, NextFunction } from "express";
import { CommonService } from "../../services/common.services";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";

const adminService = new CommonService(Admin);
const landerService = new CommonService(Lander);
const agentService = new CommonService(Agent);

// Helper function to extract URL from uploaded file object
const extractFileUrl = (file: any): string | undefined => {
  if (!file) return undefined;
  if (typeof file === "string") return file;
  if (Array.isArray(file) && file.length > 0) {
    return file[0]?.url || file[0];
  }
  return file.url || file;
};

export class AdminController {
  /**
   * Create a new user
   */
  static async createAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, email, password, role, status } = req.body;
      const user = await AdminController.createUser({
        role,
        email,
        username,
        password,
        status: status === "active",
      });
      res
        .status(201)
        .json({ success: true, message: "User created successfully", user });
    } catch (error) {
      next(error);
    }
  }

  static async getAdminById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { id } = req.params;
      let admin = await Admin.findById(id);
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }
      admin = JSON.parse(JSON.stringify(admin));

      res.status(200).json({
        success: true,
        data: { ...admin, password: "" },
        message: "Admin retrieved successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { id } = req.params;
      const { username, role, status } = req.body;
      const updatedUser = await Admin.findByIdAndUpdate(
        id,
        { username, role, status: status === "active" },
        { new: true, runValidators: true }
      );

      if (!updatedUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      res.status(200).json({
        success: true,
        message: "User updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getAllAdmins(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const pipeline = [{
        $lookup: {
          from: "roles",
          localField: "role",
          foreignField: "_id",
          as: "roleData",
        },
      },
      { $unwind: "$roleData" },
      {
        $project: {
          _id: 1,
          email: 1,
          status: 1,
          username: 1,
          createdAt: 1,
          updatedAt: 1,
          role: "$roleData.name",
        },
      }];
      const result = await adminService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Employees fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async loginAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const data = await AdminController.loginUser({ email, password });

      res.cookie("refreshToken", data.refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      // Send response with the token
      res.status(200).json({
        success: true,
        message: "Login successful",
        token: data.token, // Send the token in response
        user: {
          _id: data.user._id,
          role: data?.user.role,
          email: data.user.email,
          username: data.user.username,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get the current user details based on the provided JWT token
   * @param {Request} req - The request object
   * @param {Response} res - The response object
   * @param {NextFunction} next - The next middleware function
   */
  static async getCurrentAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user._id; // Extracted from the decoded JWT token
      const user = await AdminController.getUserById(userId);

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return; // Returning to prevent further execution
      }

      res.status(200).json({
        success: true,
        message: "User details fetched successfully",
        user: {
          _id: user._id,
          role: user.role,
          email: user.email,
          username: user.username,
        },
      });
    } catch (error) {
      next(error); // Pass errors to the error handling middleware
    }
  }

  /**
   * Get the current lander details based on the provided JWT token
   * @param {Request} req - The request object
   * @param {Response} res - The response object
   * @param {NextFunction} next - The next middleware function
   */
  static async getCurrentLander(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user._id; // Extracted from the decoded JWT token
      const lander = await AdminController.findLanderById(userId);

      if (!lander) {
        res.status(404).json({ message: "Lander not found" });
        return; // Returning to prevent further execution
      }

      res.status(200).json({
        success: true,
        message: "Lander details fetched successfully",
        user: {
          _id: lander._id,
          role: lander.role,
          email: lander.email,
          name: lander.name,
          mobile: lander.mobile,
        },
      });
    } catch (error) {
      next(error); // Pass errors to the error handling middleware
    }
  }

  /**
   * Get the current agent details based on the provided JWT token
   * @param {Request} req - The request object
   * @param {Response} res - The response object
   * @param {NextFunction} next - The next middleware function
   */
  static async getCurrentAgent(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user._id; // Extracted from the decoded JWT token
      const agent = await AdminController.findAgentById(userId);

      if (!agent) {
        res.status(404).json({ message: "Agent not found" });
        return; // Returning to prevent further execution
      }

      res.status(200).json({
        success: true,
        message: "Agent details fetched successfully",
        user: {
          _id: agent._id,
          role: agent.role,
          email: agent.email,
          name: agent.name,
          mobile: agent.mobile,
        },
      });
    } catch (error) {
      next(error); // Pass errors to the error handling middleware
    }
  }
  /**
   * Get user details by user ID
   */
  static async getUserById(userId: string) {
    const user = await Admin.findById({ _id: userId, status: true }).populate("role");
    return user;
  }

  /**
   * Get lander details by lander ID (helper method)
   */
  static async findLanderById(userId: string) {
    const lander = await Lander.findById(userId).populate("role");
    return lander;
  }

  /**
   * Get agent details by agent ID (helper method)
   */
  static async findAgentById(userId: string) {
    const agent = await Agent.findById(userId).populate("role");
    return agent;
  }

  /**
   * Create a new user
   */
  static async createUser(userData: {
    username: string;
    email: string;
    password: string;
    role: string;
    status: boolean;
  }) {
    const { username, email, password, role, status } = userData;

    const existingUser = await Admin.findOne({
      $or: [{ email }, { username }],
    });
    if (existingUser)
      throw new Error("User with this email or username already exists");

    const user = new Admin({ username, email, password, role, status });
    return await user.save();
  }

  /**
   * Login a user
   */
  static async loginUser(loginData: { email: string; password: string }) {
    const { email, password } = loginData;

    const user: any = await Admin.findOne({ email }).populate("role");
    if (!user) throw new Error("User not found with this email");

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new Error("Password is incorrect");

    const payload = {
      email: user.email,
      _id: user._id as string,
      role: (user?.role?.name as any) ?? "admin",
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    user.refreshToken = refreshToken;
    await user.save();

    return {
      user,
      refreshToken,
      token: accessToken,
      message: "Login successful",
    };
  }

  // ==================== LANDER CRUD OPERATIONS ====================

  /**
   * Login a lander
   */
  static async loginLander(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const data = await AdminController.loginLanderUser({ email, password });

      res.cookie("refreshToken", data.refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      // Send response with the token
      res.status(200).json({
        success: true,
        message: "Login successful",
        token: data.token, // Send the token in response
        user: {
          _id: data.user._id,
          role: data?.user.role,
          email: data.user.email,
          name: data.user.name,
          mobile: data.user.mobile,
        },
      });
    } catch (error) {
      next(error);
    }
  }


  /**
   * Login a lander user (helper method)
   */
  static async loginLanderUser(loginData: { email: string; password: string }) {
    const { email, password } = loginData;

    const lander: any = await Lander.findOne({ email }).populate("role");
    if (!lander) throw new Error("Lander not found with this email");

    const isMatch = await lander.comparePassword(password);
    if (!isMatch) throw new Error("Password is incorrect");

    const payload = {
      email: lander.email,
      _id: lander._id as string,
      role: (lander?.role?.name as any) ?? "lander",
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    lander.refreshToken = refreshToken;
    await lander.save();

    return {
      user: lander,
      refreshToken,
      token: accessToken,
      message: "Login successful",
    };
  }

  /**
   * Login an agent
   */
  static async loginAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const data = await AdminController.loginAgentUser({ email, password });

      res.cookie("refreshToken", data.refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      // Send response with the token
      res.status(200).json({
        success: true,
        message: "Login successful",
        token: data.token, // Send the token in response
        user: {
          _id: data.user._id,
          role: data?.user.role,
          email: data.user.email,
          name: data.user.name,
          mobile: data.user.mobile,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login an agent user (helper method)
   */
  static async loginAgentUser(loginData: { email: string; password: string }) {
    const { email, password } = loginData;

    const agent: any = await Agent.findOne({ email }).populate("role");
    if (!agent) throw new Error("Agent not found with this email");

    const isMatch = await agent.comparePassword(password);
    if (!isMatch) throw new Error("Password is incorrect");

    const payload = {
      email: agent.email,
      _id: agent._id as string,
      role: (agent?.role?.name as any) ?? "agent",
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    agent.refreshToken = refreshToken;
    await agent.save();

    return {
      user: agent,
      refreshToken,
      token: accessToken,
      message: "Login successful",
    };
  }

  /**
   * Create a new lander
   */
  static async createLander(req: Request, res: Response, next: NextFunction) {
    try {
      // Process profile picture upload
      if (req.body.profilePictureUrl) {
        const url = extractFileUrl(req.body.profilePictureUrl);
        if (url) {
          req.body.profilePictureUrl = url;
        }
      }

      const result = await landerService.create(req.body);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create lander"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Lander created successfully"));
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get all landers
   */
  static async getAllLanders(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "roles",
            localField: "role",
            foreignField: "_id",
            as: "roleData",
          },
        },
        { $unwind: "$roleData" },
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            mobile: 1,
            location: 1,
            availability: 1,
            profilePictureUrl: 1,
            serviceablePincodes: 1,
            createdAt: 1,
            updatedAt: 1,
            leadCapacity: 1,
            activeLeads: 1,
            completedLeads: 1,
            role: "$roleData.name",
          },
        },
      ];
      const result = await landerService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Landers fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get lander by ID
   */
  static async getLanderById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await landerService.getById(
        req.params.id,
        { path: "role", select: "name" }
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Lander not found"));
      
      // Remove password from response
      const landerData = result.toObject ? result.toObject() : result;
      const { password, ...landerWithoutPassword } = landerData;
      
      return res
        .status(200)
        .json(new ApiResponse(200, landerWithoutPassword, "Lander fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update lander by ID
   */
  static async updateLanderById(req: Request, res: Response, next: NextFunction) {
    try {
      // Prevent password update through this endpoint (should use separate password change endpoint)
      const { password, ...updateData } = req.body;
      
      // Process profile picture upload
      if (updateData.profilePictureUrl) {
        const url = extractFileUrl(updateData.profilePictureUrl);
        if (url) {
          updateData.profilePictureUrl = url;
        }
      }
      
      const result = await landerService.updateById(req.params.id, updateData, {
        populate: { path: "role", select: "name" },
        new: true,
        runValidators: true,
      });
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to update lander"));
      
      // Remove password from response
      const landerData = result.toObject ? result.toObject() : result;
      const { password: _, ...landerWithoutPassword } = landerData;
      
      return res
        .status(200)
        .json(new ApiResponse(200, landerWithoutPassword, "Lander updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete lander by ID
   */
  static async deleteLanderById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await landerService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete lander"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Lander deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
