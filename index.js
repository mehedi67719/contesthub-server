const express = require('express')
const app = express()
const cors = require('cors');
require('dotenv').config();


const stripe = require('stripe')(process.env.PAYMENT_KEY);

const port = process.env.PORT || 3000

app.use(express.json())
app.use(cors())


const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGO_URI


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    await client.connect();

    const db = client.db("Contesthub");
    const contestcollection = db.collection("contest")


    app.get("/contests", async (req, res) => {
      try {
        const contest = await contestcollection.find().toArray();
        res.send(contest)
      }
      catch (error) {
        console.log(error)
        res.status(500).send({ error: "failed to fetch contest" })
      }
    })


    app.get("/top-contests", async (req, res) => {
      try {
        const top_contests = await contestcollection.find().sort({ participantsCount: -1 }).limit(5).toArray();
        res.send(top_contests)
      }
      catch (error) {
        res.status(500).json({ message: "server error" })
      }
    })


    app.post('/create-checkout-session', async (req, res) => {
      const paymentinfo = req.body;
      const amount = parseInt(paymentinfo.cost) * 100

    
      if (amount <= 0 || !paymentinfo.email || !paymentinfo.id) {
          return res.status(400).send({ error: "Invalid payment information." });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'USD',
                unit_amount: amount,
                product_data: {
                  name: paymentinfo.name
                }
              },
              quantity: 1,
            },
          ],
          customer_email: paymentinfo.email,
          mode: 'payment',
          metadata: {
            contestId: paymentinfo.id.toString()
          },

          
          success_url: `${process.env.SITE_DOMAIN}/payment-success/${paymentinfo.id}?session_id={CHECKOUT_SESSION_ID}`,
         
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel/${paymentinfo.id}`,
        });

        console.log("Stripe Session Created:", session.id);
        res.send({ url: session.url })

      } catch (error) {
          console.error("Error creating Stripe session:", error);
          res.status(500).send({ error: "Failed to create checkout session" });
      }
    });


    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    //
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})