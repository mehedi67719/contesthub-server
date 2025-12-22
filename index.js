const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_KEY);

const app = express();
app.use(express.json());
app.use(cors());

const client = new MongoClient(process.env.MONGO_URI);

let contestCollection, paymentCollection, tasksCollection, userCollection, wincollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("Contesthub");

    contestCollection = db.collection("contest");
    paymentCollection = db.collection("payments");
    tasksCollection = db.collection("tasks");
    userCollection = db.collection("User");
    wincollection = db.collection("win");

    await paymentCollection.createIndex({ tranjectionid: 1 }, { unique: true }).catch(() => {});

    const contestCount = await contestCollection.countDocuments();
    if (contestCount === 0) {
      await contestCollection.insertMany([
        { name: "Contest A", participantsCount: 0, paymentstatus: "unpaid" },
        { name: "Contest B", participantsCount: 0, paymentstatus: "unpaid" }
      ]);
    }

    app.get("/api/contests", async (req, res) => {
      try {
        const contests = await contestCollection.find({
          $or: [{ status: "approve" }, { status: { $exists: false } }]
        }).sort({ createdAt: -1 }).toArray();
        res.send(contests);
      } catch {
        res.status(500).send({ message: "Failed to retrieve contests." });
      }
    });

    app.get("/api/contests/:id", async (req, res) => {
      try {
        const result = await contestCollection.findOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch {
        res.status(404).send("Server error");
      }
    });

    app.delete("/api/contests/:id", async (req, res) => {
      try {
        const result = await contestCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch {
        res.status(404).send("Server error");
      }
    });

    app.patch("/api/contests/:id", async (req, res) => {
      try {
        const d = req.body;
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $set: {
              name: d.name,
              image: d.image,
              description: d.description,
              entryFee: Number(d.entryFee),
              price: Number(d.price),
              prizeMoney: Number(d.prizeMoney),
              taskInstruction: d.taskInstruction,
              contestType: d.contestType,
              deadline: new Date(d.deadline)
            }
          }
        );
        res.send(result);
      } catch {
        res.status(500).send({ success: false });
      }
    });

    app.get("/api/contests/user/:email", async (req, res) => {
      try {
        const contests = await contestCollection.find({ creatorEmail: req.params.email }).toArray();
        res.send(contests);
      } catch {
        res.status(500).send({ message: "Failed to retrieve contests." });
      }
    });

    app.get("/api/All-contests", async (req, res) => {
      const contests = await contestCollection.find().toArray();
      res.send(contests);
    });

    app.post("/api/All-contests", async (req, res) => {
      const result = await contestCollection.insertOne(req.body);
      res.send(result);
    });

    app.get("/api/user", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.post("/api/user", async (req, res) => {
      const existing = await userCollection.findOne({ email: req.body.email });
      if (existing) return res.status(400).send({ message: "User already exists" });
      const result = await userCollection.insertOne(req.body);
      res.send(result);
    });

    app.post("/api/user-request", async (req, res) => {
      const result = await userCollection.updateOne(
        { email: req.body.useremail },
        { $set: { role: req.body.role } }
      );
      res.send(result);
    });

    app.get("/api/task", async (req, res) => {
      const tasks = await tasksCollection.find().toArray();
      res.send(tasks);
    });

    app.get("/api/task/:id", async (req, res) => {
      const tasks = await tasksCollection.find({ contest_id: req.params.id }).toArray();
      res.send(tasks);
    });

    app.post("/api/tasks", async (req, res) => {
      const exist = await tasksCollection.findOne({
        contest_id: req.body.contest_id,
        user_email: req.body.user_email
      });
      if (exist) return res.status(400).send({ message: "Task already submitted" });
      const result = await tasksCollection.insertOne(req.body);
      res.send(result);
    });

    app.post("/api/win", async (req, res) => {
      const result = await wincollection.insertOne(req.body);
      res.send(result);
    });

    app.get("/api/win", async (req, res) => {
      const result = await wincollection.find().toArray();
      res.send(result);
    });

    app.get("/api/win/:email", async (req, res) => {
      const result = await wincollection.find({ winnerEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.get("/api/win-leaderboard", async (req, res) => {
      const result = await wincollection.aggregate([
        { $group: { _id: "$winnerEmail", totalWins: { $sum: 1 } } },
        { $sort: { totalWins: -1 } }
      ]).toArray();
      res.send(result);
    });

    app.post("/api/create-checkout-session", async (req, res) => {
      const amount = parseInt(req.body.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: "USD",
            unit_amount: amount,
            product_data: { name: req.body.name }
          },
          quantity: 1
        }],
        customer_email: req.body.email,
        mode: "payment",
        metadata: { contestId: req.body.id },
        success_url: `${process.env.SITE_DOMAIN}/payment-success/${req.body.id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel/${req.body.id}`
      });
      res.send({ url: session.url });
    });

    app.get("/api/payment-success", async (req, res) => {
      const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
      const transactionId = session.payment_intent;
      const contestId = session.metadata.contestId;
      const trackingid = uuidv4();

      await paymentCollection.updateOne(
        { tranjectionid: transactionId },
        {
          $setOnInsert: {
            amount: session.amount_total / 100,
            currency: session.currency,
            Customer_email: session.customer_email,
            contest_id: contestId,
            payment_status: "paid",
            tranjectionid: transactionId,
            paidat: new Date(),
            trackingid
          }
        },
        { upsert: true }
      );

      await contestCollection.updateOne(
        { _id: new ObjectId(contestId) },
        { $inc: { participantsCount: 1 } }
      );

      res.send({ success: true, trackingid });
    });

    console.log("MongoDB connected");
  } catch (err) {
    console.error(err);
  }
}

run();

app.get("/", (req, res) => res.send("Server running"));
module.exports = app;
