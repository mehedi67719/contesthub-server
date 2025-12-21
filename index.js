const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_KEY);
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    'http://localhost:5173', 
    'https://contesthub-client.web.app', // আপনার ফ্রন্টেন্ডের লাইভ ইউআরএল এখানে দিন
    'https://contesthub-client.firebaseapp.com' 
  ],
  credentials: true
}));

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let db, contestCollection, paymentCollection, tasksCollection, userCollection, wincollection;

async function connectDB() {
  if (db) return { contestCollection, paymentCollection, tasksCollection, userCollection, wincollection };
  await client.connect();
  db = client.db("Contesthub");
  contestCollection = db.collection("contest");
  paymentCollection = db.collection("payments");
  tasksCollection = db.collection("tasks");
  userCollection = db.collection("User");
  wincollection = db.collection("win");
  return { contestCollection, paymentCollection, tasksCollection, userCollection, wincollection };
}

const veryfbtocken = async (req, res, next) => {
  const accesstocken = req.headers.authorization;
  if (!accesstocken) {
    return res.status(401).send({ message: "Unauthorized error" });
  }
  try {
    const userinfo = await admin.auth().verifyIdToken(accesstocken);
    req.user = userinfo;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorized error" });
  }
}

app.get("/", (req, res) => res.send("Server running"));

app.get("/All-contests", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const contests = await contestCollection.find().toArray();
    res.send(contests);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/contests", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const contests = await contestCollection.find({
      $or: [{ status: "approve" }, { status: { $exists: false } }]
    }).sort({ createdAt: -1 }).toArray();
    res.send(contests);
  } catch {
    res.status(500).send({ message: "Failed to retrieve contests." });
  }
});

app.get("/contests/:id", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const result = await contestCollection.findOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch {
    res.status(404).send('Server error');
  }
});

app.delete("/contests/:id", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const result = await contestCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch {
    res.status(500).send('Server error');
  }
});

app.patch("/contests/:id", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const updatedData = req.body;
    const filter = { _id: new ObjectId(req.params.id) };
    const updateDoc = {
      $set: {
        name: updatedData.name,
        image: updatedData.image,
        description: updatedData.description,
        entryFee: Number(updatedData.entryFee),
        price: Number(updatedData.price),
        prizeMoney: Number(updatedData.prizeMoney),
        taskInstruction: updatedData.taskInstruction,
        contestType: updatedData.contestType,
        deadline: new Date(updatedData.deadline)
      }
    };
    const result = await contestCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch {
    res.status(500).send({ success: false, error: "Something went wrong" });
  }
});

app.get("/contests/user/:email", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const contests = await contestCollection.find({ creatorEmail: req.params.email }).toArray();
    res.send(contests);
  } catch {
    res.status(500).send({ message: "Failed to retrieve contests." });
  }
});

app.post("/All-contests", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const result = await contestCollection.insertOne(req.body);
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.post("/win", async (req, res) => {
  try {
    const { wincollection } = await connectDB();
    const result = await wincollection.insertOne(req.body);
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/win-leaderboard", async (req, res) => {
  try {
    const { wincollection } = await connectDB();
    const result = await wincollection.aggregate([
      { $group: { _id: "$winnerEmail", totalWins: { $sum: 1 } } },
      { $sort: { totalWins: -1 } }
    ]).toArray();
    res.send(result);
  } catch {
    res.status(500).send({ message: "server error" });
  }
});

app.get("/win/:email", async (req, res) => {
  try {
    const { wincollection } = await connectDB();
    const result = await wincollection.find({ winnerEmail: req.params.email }).toArray();
    res.send(result);
  } catch {
    res.status(500).send({ message: "server error" });
  }
});

app.get("/top-contests", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const contests = await contestCollection.find({
      $or: [{ status: "approve" }, { status: { $exists: false } }]
    }).sort({ participantsCount: -1 }).limit(5).toArray();
    res.send(contests);
  } catch {
    res.status(500).send({ message: "Failed to retrieve top contest" });
  }
});

app.get("/user", async (req, res) => {
  try {
    const { userCollection } = await connectDB();
    const result = await userCollection.find().toArray();
    res.send(result);
  } catch {
    res.status(500).send({ message: "Failed to load user" });
  }
});

app.post("/user", veryfbtocken, async (req, res) => {
  try {
    const { userCollection } = await connectDB();
    const user = req.body;
    const existingUser = await userCollection.findOne({ email: user.email });
    if (existingUser) return res.status(200).send({ message: "User already exists" });
    const result = await userCollection.insertOne(user);
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.post("/user-request", async (req, res) => {
  try {
    const { userCollection } = await connectDB();
    const { role, useremail } = req.body;
    const result = await userCollection.updateOne({ email: useremail }, { $set: { role } });
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.post("/tasks", async (req, res) => {
  try {
    const { tasksCollection } = await connectDB();
    const task = req.body;
    const existingTask = await tasksCollection.findOne({ contest_id: task.contest_id, user_email: task.user_email });
    if (existingTask) return res.status(400).send({ message: "Task already submitted" });
    const result = await tasksCollection.insertOne(task);
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/task/:id", async (req, res) => {
  try {
    const { tasksCollection } = await connectDB();
    const result = await tasksCollection.find({ contest_id: req.params.id }).toArray();
    res.send(result);
  } catch {
    res.status(500).send({ message: "Server error" });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cost, email, id, name } = req.body;
    const amount = parseInt(cost) * 100;
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price_data: { currency: "USD", unit_amount: amount, product_data: { name } }, quantity: 1 }],
      customer_email: email,
      mode: "payment",
      metadata: { contestId: id.toString() },
      success_url: `${process.env.SITE_DOMAIN}/payment-success/${id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel/${id}`,
    });
    res.send({ url: session.url });
  } catch {
    res.status(400).send({ error: "Invalid payment data" });
  }
});

app.get("/payment-success", async (req, res) => {
  try {
    const { paymentCollection, contestCollection } = await connectDB();
    const sessionId = req.query.session_id;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") return res.status(400).send({ success: false });

    const contestId = session.metadata.contestId;
    const transactionId = session.payment_intent;
    const contest = await contestCollection.findOne({ _id: new ObjectId(contestId) });

    const payment = {
      amount: session.amount_total / 100,
      Customer_email: session.customer_email,
      contest_id: contestId,
      payment_status: "paid",
      tranjectionid: transactionId,
      paidat: new Date(),
      contest_name: contest?.name,
      trackingid: uuidv4()
    };

    await paymentCollection.updateOne({ tranjectionid: transactionId }, { $setOnInsert: payment }, { upsert: true });
    await contestCollection.updateOne({ _id: new ObjectId(contestId) }, { $inc: { participantsCount: 1 } });
    res.send({ success: true, trackingid: payment.trackingid });
  } catch {
    res.status(500).send({ success: false, error: "Server Error" });
  }
});

app.patch("/contest-status/:id", async (req, res) => {
  try {
    const { contestCollection } = await connectDB();
    const result = await contestCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status } });
    res.send(result);
  } catch {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;