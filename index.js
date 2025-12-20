const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const e = require('express');
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
    const tasksCollection = db.collection("tasks");
    const userCollection = db.collection("User");
    const wincollection = db.collection("win");


    await paymentCollection.createIndex({ tranjectionid: 1 }, { unique: true }).catch(() => { });


    const contestCount = await contestCollection.countDocuments();
    if (contestCount === 0) {
      await contestCollection.insertMany([
        { name: "Contest A", participantsCount: 0, paymentstatus: "unpaid" },
        { name: "Contest B", participantsCount: 0, paymentstatus: "unpaid" }
      ]);
    }


    app.get("/contests", async (req, res) => {
      try {
        const contests = await contestCollection.find({
          $or: [
            { status: "approve" },
            { status: { $exists: false } }
          ]
        }).sort({ createdAt: -1 }).toArray();
        res.send(contests);
      }
      catch {
        res.status(500).send({ message: "Failed to retrieve contests." });
      }
    });


    app.delete("/contests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        console.log(id)
        const result = await contestCollection.deleteOne({ _id: new ObjectId(id) })
        res.send(result)
      }
      catch {
        res.status(404).send('Serverr error');
      }
    })



    app.get("/contests/:email", async (req, res) => {
      try {
        const email = req.params.email
        const contests = await contestCollection.find({ creatorEmail: email }).toArray();
        res.send(contests);
      }
      catch {
        res.status(500).send({ message: "Failed to retrieve contests." });
      }
    });




    app.get("/All-contests", async (req, res) => {
      try {
        const contests = await contestCollection.find().toArray();
        res.send(contests);
      }
      catch {
        res.status(500).send({ message: "Failed to retrieve contests." });
      }
    });


    app.post("/All-contests", async (req, res) => {
      try {
        const data = req.body;
        const result = await contestCollection.insertOne(data)
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "Server error" })
      }


    })

    app.post("/win", async (req, res) => {
      try {
        const { taskId, contestname, winnerEmail, price } = req.body;
        const data = { taskId, contestname, winnerEmail, price };
        console.log(data)
        const result = await wincollection.insertOne(data)
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "Server error" })
      }


    })


    app.get("/win", async (req, res) => {
      try {
        const result = await wincollection.find().toArray()
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "server error" });
      }
    })


    app.get("/win/:email", async (req, res) => {
      try {
        const email = req.params.email
        console.log(email)
        const result = await wincollection.find({ winnerEmail: email }).toArray()
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "server error" });
      }
    })



    app.get("/top-contests", async (req, res) => {
      try {
        const contests = await contestCollection.find({
          $or: [
            { status: "approve" },
            { status: { $exists: false } }
          ]
        }).sort({ participantsCount: -1 }).limit(5).toArray();
        res.send(contests);
      }
      catch {
        res.status(500).send({ message: "Failed to retrieve top contest" });
      }
    });


    app.get("/payment", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email query required" });

      try {
        const payments = await paymentCollection.find({ Customer_email: email }).toArray();
        res.send(payments);
      } catch {
        res.status(500).send({ message: "Failed to retrieve payment history." });
      }
    });

    app.get("/user", async (req, res) => {
      try {
        const result = await userCollection.find().toArray()
        res.send(result)
      } catch {
        res.status(500).send({ message: "Failed to load user" });
      }
    })


    app.get("/task", async (req, res) => {
      try {
        const result = await tasksCollection.find().toArray()
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "Server error" });
      }
    })






    app.post("/user-request", async (req, res) => {
      const { role, useremail } = req.body;

      // console.log(role,useremail)

      try {
        const existingUser = await userCollection.findOne({ email: useremail })

        if (!existingUser) return res.status(400).send({ message: "User eamil not found" });


        const result = await userCollection.updateOne(
          { email: useremail },
          { $set: { role } }
        )
        res.send(result)
      }
      catch {
        res.status(500).send({ message: "Server error" });
      }

    })


    app.post("/tasks", async (req, res) => {
      const task = req.body;
      console.log(task)
      try {
        const existingTask = await tasksCollection.findOne({ contest_id: task.contest_id, user_email: task.user_email });
        if (existingTask) return res.status(400).send({ message: "Task already submitted" });
        const result = await tasksCollection.insertOne(task);
        res.send(result);
      } catch (err) {
        console.log(err)
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





    app.get("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // console.log(session)
        if (!session || session.payment_status !== "paid") {
          return res.status(400).send({ success: false, error: "Payment not completed" });
        }

        const transactionId = session.payment_intent;
        const contestId = session.metadata.contestId;
        const trackingid = uuidv4();

        const contest = await contestCollection.findOne({ _id: contestId });

        // console.log(contest)


        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          Customer_email: session.customer_email,
          contest_id: contestId,
          payment_status: "paid",
          tranjectionid: transactionId,
          paidat: new Date(),
          contest_name: contest?.name,
          trackingid
        };

        await paymentCollection.updateOne(
          { tranjectionid: transactionId },
          { $setOnInsert: payment },
          { upsert: true }
        );

        await contestCollection.updateOne(
          { _id: new ObjectId(contestId) },
          { $inc: { participantsCount: 1 } }
        );

        res.send({ success: true, trackingid });
      } catch (error) {
        res.status(500).send({ success: false, error: "Server Error" });
      }
    });



    app.patch("/contest-status/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;


        console.log(id, status)


        const filter = { _id: new ObjectId(id) }
        const updatedoc = {
          $set: { status: status }
        }

        const result = await contestCollection.updateOne(filter, updatedoc);
        res.send(result);
      }
      catch (err) {
        console.log(err)
        res.status(500).send({ message: "Internal Server Error" })
      }
    })



    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connected successfully!");
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Server running"));
app.listen(port, () => console.log(`Server running on port ${port}`));
