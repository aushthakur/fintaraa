import jwt from "jsonwebtoken";
import Otp from "../../modals/otp.model";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { sendEmail } from "../../utils/emailService";
import { Request, Response, NextFunction } from "express";
import { User, UserStatus } from "../../modals/user.model";
import { CommonService } from "../../services/common.services";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";

const otpService = new CommonService(Otp);
const userService = new CommonService(User);

export class UserController {
  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        email,
        mobile,
        panCard,
        aadhaarCard,
        role = "user",
        agreedToTerms = true,
        privacyPolicyAccepted = true,
      } = req.body;

      const panCardUrl = req?.body?.panCardUrl?.[0]?.url;
      const aadhaarCardUrl = req?.body?.aadhaarCardUrl?.[0]?.url;
      const cancelledChequeOrPassbook = req?.body?.cancelledChequeOrPassbook?.[0]?.url;

      if (!email || !mobile || !name) {
        return res
          .status(400)
          .json(new ApiError(400, "Missing required fields"));
      }

      const userData: any = {
        role,
        name,
        email,
        mobile,
        panCard,
        panCardUrl,
        aadhaarCard,
        agreedToTerms,
        aadhaarCardUrl,
        password: "password",
        privacyPolicyAccepted,
        isEmailVerified: false,
        isMobileVerified: false,
        cancelledChequeOrPassbook,
        status:
          role === "user"
            ? UserStatus.ACTIVE
            : UserStatus.PENDING_VERIFICATION,
      };

      const eixsts = await User.findOne({ mobile, email });
      if (eixsts) {
        return res
          .status(400)
          .json(new ApiError(400, "Phone Number & Email ID Already Exist!"));
      }
      const response = await userService.create(userData);
      return res
        .status(201)
        .json(
          new ApiResponse(
            201,
            response,
            `Account created successfully! Please verify your account!`
          )
        );
    } catch (error) {
      console.log("Error: ", error);
      next(error);
    }
  }

  static async loginUser(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email }).select("+password");
      const userData: any = await User.findOne({ email });

      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const payload = {
        role: "user",
        _id: userData._id,
        email: userData.email,
      };
      const token = jwt.sign(payload, config.jwt.secret, { expiresIn: "7d" });
      res.status(200).json({
        user,
        token,
        success: true,
        message: "Login successful",
      });
    } catch (error) {
      console.log("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };

  static async generateOtp(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { mobile } = req.body;

      if (!mobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      const user = await User.findOne({ mobile });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "No user found with this phone number",
        });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins expiry

      // Save or update OTP
      await Otp.findOneAndUpdate(
        { mobile },
        {
          expiresAt,
          mobile,
          otp: otpCode,
          verified: false,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // TODO: Integrate real SMS service like Twilio or Fast2SMS
      console.log(`OTP sent to ${mobile}: ${otpCode}`);
      await sendEmail({
        otp: otpCode,
        to: user?.email,
        userName: user?.name,
      });

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user } = (req as any).user;
      const result = await userService.deleteById(req.params.id || user);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete city"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { userType } = req.params;
      const result = await userService.getAll({ ...req.query, role: userType });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Users fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id } = req.user;
      const { id } = req.params;
      const profilePicture = req.body.profilePicture?.[0]?.url;
      const existingUser = await userService.getById(id || _id);
      if (!existingUser)
        return res.status(404).json(new ApiError(404, "user not found"));

      let avatar;
      if (req.body.avatar?.[0]?.url)
        avatar = await extractImageUrl(
          req.body.avatar,
          existingUser?.avatar as string
        );

      const data: any = { ...req.body, avatar: avatar || profilePicture };
      const result = await userService.updateById(id || _id, data);
      return res
        .status(200)
        .json(new ApiResponse(200, result, `User updated successfully`));
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, otp } = req.body;

      if (!mobile || !otp) {
        return res.status(400).json({
          success: false,
          message: "Phone number and OTP are required",
        });
      }

      const otpDoc = await Otp.findOne({ mobile, otp });

      if (!otpDoc || otpDoc.expiresAt < new Date()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired OTP" });
      }

      if (otpDoc.verified) {
        return res
          .status(400)
          .json({ success: false, message: "OTP already used" });
      }

      otpDoc.verified = true;
      await otpDoc.save();

      const user: any = await User.findOne({ mobile });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if ([UserStatus.SUSPENDED, UserStatus.INACTIVE].includes(user.status)) {
        return res
          .status(403)
          .json({ success: false, message: `Account ${user.status}` });
      }

      user.isMobileVerified = true;
      user.status = UserStatus.ACTIVE;

      const payload = { _id: user._id, email: user.email, role: user.role };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);
      user.refreshToken = refreshToken;
      await user.save();

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        message: "OTP verified successfully. Login complete.",
        token: accessToken,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { _id: userId } = (req as any).user;
      const result = await userService.getById(userId);
      return res
        .status(200)
        .json(new ApiResponse(200, result, `User fetched successfully`));
    } catch (error) {
      next(error); // Pass errors to the error handling middleware
    }
  }

  static async getAllOTPLogs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const response = await otpService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, response, "User fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const userId = req.params.id;
      const response = await userService.getById(userId);
      return res
        .status(200)
        .json(new ApiResponse(200, response, "User fetched successfully"));
    } catch (error) {
      next(error);
    }
  }
}
