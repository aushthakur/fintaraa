import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBookmark extends Document {
  createdAt: Date;
  updatedAt: Date;
  user: Types.ObjectId;
  room?: Types.ObjectId;
  property?: Types.ObjectId;
}

const bookmarkSchema = new Schema<IBookmark>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required for a bookmark."],
      index: true,
    },
    property: {
      type: Schema.Types.ObjectId,
      ref: "Property",
    },
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
    },
  },
  { timestamps: true }
);

// Ensure that at least one of 'property' or 'room' is present
bookmarkSchema.pre("validate", function (next) {
  if (!this.property && !this.room) {
    return next(new Error("A bookmark must be linked to either a property or a room."));
  }
  next();
});

// Unique constraint: User + Property + Room combination
bookmarkSchema.index(
  { user: 1, property: 1, room: 1 },
  { unique: true }
);

export const Bookmark = mongoose.model<IBookmark>("Bookmark", bookmarkSchema);
