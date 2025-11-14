import Role from "../modals/role.model";
import { config } from "../config/config";
import Admin from "../modals/admin.model";

export const createDefaultAdmin = async () => {
  const { name, email, password, enabled } = config.initAdmin;
  if (!enabled) return;

  try {
    let adminRole = await Role.findOne({ name: "admin" });
    if (!adminRole) {
      adminRole = await Role.create({
        name: "admin",
        description: "Administrator with full access",
        permissions: [
          {
            module: "Role Management",
            access: {
              read: true,
              create: true,
              update: true,
              delete: true,
            },
          },
        ],
      });
      console.log("✅ Admin role created successfully.");
    }

    // 🔹 Check if default admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      console.log("ℹ️ Default admin already exists.");
      return;
    }

    // 🔹 Create default admin user with the role
    await Admin.create({
      email,
      password,
      status: true,
      username: name,
      role: adminRole._id,
    });

    console.log("✅ Default admin created successfully.");
  } catch (err: any) {
    console.log("❌ Failed to create default admin:", err.message || err);
  }
};
