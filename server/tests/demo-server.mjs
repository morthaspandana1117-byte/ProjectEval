// Local demo: API on :5000 backed by a throwaway in-memory MongoDB with sample data.
// Never touches Atlas. Run: node tests/demo-server.mjs
process.env.NODE_ENV = "development";
const { MongoMemoryServer } = await import("mongodb-memory-server");
const mongoose = (await import("mongoose")).default;
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
const { createApp } = await import("../src/app.js");
const { User } = await import("../src/models/Users.js");
const { Project } = await import("../src/models/Project.js");
await mongoose.connection.syncIndexes();

const pw = "Passw0rd!";
await User.create({ name: "Event Admin", email: "admin@demo.edu", password: pw, role: "admin" });
const guide = await User.create({ name: "Dr. Meera Iyer", email: "meera@demo.edu", password: pw, role: "faculty", employeeId: "FAC-01", department: "CSE" });
const asha = await User.create({ name: "Asha Rao", email: "asha@demo.edu", password: pw, role: "student", rollNumber: "21CS001", department: "CSE", year: 4 });
await User.create({ name: "Ravi Kumar", email: "ravi@demo.edu", password: pw, role: "student", rollNumber: "21CS050", department: "CSE", year: 3 });
await Project.create({
  projectNumber: "CSE-001", title: "Smart Attendance System", status: "approved",
  description: "Captures classroom images, detects faces and matches them to enrolled students to record attendance automatically.",
  teamMembers: [{ name: "Asha Rao", rollNumber: "21CS001" }],
  facultyGuide: guide.name, submittedBy: asha._id,
});
const port = Number(process.env.DEMO_PORT) || 5055;
createApp().listen(port, () => console.log(`Demo API on http://localhost:${port}` + ` (password for all demo users: ${pw})`));
