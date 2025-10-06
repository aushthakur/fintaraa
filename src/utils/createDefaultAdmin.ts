import Admin from "../modals/admin.model";
import { config } from "../config/config";

export const createDefaultAdmin = async () => {
    const { name, email, password, enabled } = config.initAdmin;
    if (!enabled) return;

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return;
    await Admin.create({
        email,
        password,
        role: "admin",
        status: true,
        username: name,
    });
    console.log("✅ Default admin created successfully.");
};
