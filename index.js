const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_KEY);

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;

const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("Contesthub");
    const contestCollection = db.collection("contest");
    const paymentCollection = db.collection("payments");
    const taskCollection = db.collection("tasks");
    const userCollection = db.collection("User");


    await paymentCollection.createIndex({ tranjectionid: 1 }, { unique: true }).catch(() => {});

 
    const contestCount = await contestCollection.countDocuments();
    if (contestCount === 0) {
      await contestCollection.insertMany([
        { name: "Contest A", participantsCount: 0, paymentstatus: "unpaid" },
        { name: "Contest B", participantsCount: 0, paymentstatus: "unpaid" }
      ]);
    }


    app.get("/contests", async (req, res) => {
      const contests = await contestCollection.find().toArray();
      res.send(contests);
    });


    app.get("/top-contests", async (req, res) => {
      const top = await contestCollection.find().sort({ participantsCount: -1 }).limit(5).toArray();
      res.send(top);
    });

 
    app.get("/participated", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email query required" });

      try {
        const payments = await paymentCollection.find({ Customer_email: email }).toArray();
        res.send(payments);
      } catch {
        res.status(500).send({ message: "Failed to retrieve payment history." });
      }
    });

   
    app.post("/tasks", async (req, res) => {
      const task = req.body;
      try {
        const existingTask = await taskCollection.findOne({ contest_id: task.contest_id, user_email: task.user_email });
        if (existingTask) return res.status(400).send({ message: "Task already submitted" });
        const result = await taskCollection.insertOne(task);
        res.send(result);
      } catch {
        res.status(500).send({ message: "Server error" });
      }
    });

    
    app.post("/user", async (req, res) => {
      const user = req.body;
      try {
        const existingUser = await userCollection.findOne({ email: user.email });
        if (existingUser) return res.status(400).send({ message: "User already exists" });
        const result = await userCollection.insertOne(user);
        res.send(result);
      } catch {
        res.status(500).send({ message: "Server error" });
      }
    });

    
    app.post("/create-checkout-session", async (req, res) => {
      const { cost, email, id, name } = req.body;
      const amount = parseInt(cost) * 100;
      if (!amount || !email || !id) return res.status(400).send({ error: "Invalid payment data" });

      const session = await stripe.checkout.sessions.create({
        line_items: [
          { 
            price_data: { currency: "USD", unit_amount: amount, product_data: { name } }, 
            quantity: 1 
          }
        ],
        customer_email: email,
        mode: "payment",
        metadata: { contestId: id.toString() },
        success_url: `${process.env.SITE_DOMAIN}/payment-success/${id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel/${id}`,
      });

      res.send({ url: session.url });
    });

   
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || session.payment_status !== "paid") {
          return res.status(400).send({ success: false, error: "Payment not completed" });
        }

        const transactionId = session.payment_intent;
        const contestId = session.metadata.contestId;
        const trackingid = uuidv4();

        const contest = await contestCollection.findOne({ _id: new ObjectId(contestId) });

    
        if (contest && (!contest.paymentstatus || contest.paymentstatus !== "paid")) {
          await contestCollection.updateOne(
            { _id: new ObjectId(contestId) },
            { $set: { paymentstatus: "paid", trackingid }, $inc: { participantsCount: 1 } }
          );
        }

      
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          Customer_email: session.customer_email,
          contest_id: contestId,
          paymentstatus: session.payment_status,
          tranjectionid: transactionId,
          paidat: new Date(),
          contest_name: contest.name,
          trackingid
        };

        await paymentCollection.updateOne(
          { tranjectionid: transactionId },
          { $setOnInsert: payment },
          { upsert: true }
        );

        res.send({ success: true, trackingid, tranjectionid: transactionId });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, error: "Something went wrong" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connected successfully!");
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Server running"));
app.listen(port, () => console.log(`Server running on port ${port}`));
