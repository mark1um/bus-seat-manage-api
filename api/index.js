const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const { PassThrough } = require("stream");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

// Singleton pattern para o PrismaClient
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });
};

const globalForPrisma = globalThis;
const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Rotas de viagens
app.post("/trips", async (req, res) => {
  try {
    const { destination, departureDate, departureTime, price, busType } = req.body;
    const trip = await prisma.trip.create({
      data: {
        id: uuidv4(),
        destination,
        departureDate,
        departureTime,
        price,
        busType,
      },
    });
    res.status(201).json(trip);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/trips", async (req, res) => {
  try {
    const trips = await prisma.trip.findMany({
      orderBy: {
        departureDate: 'desc'
      },
      include: {
        passengers: true
      }
    });

    // Adicionar informações de contagem de assentos para cada viagem
    const tripsWithSeatInfo = trips.map(trip => {
      const totalSeats = {
        small: 20,
        medium: 30,
        large: 50
      }[trip.busType];

      const occupiedSeats = trip.passengers.length;
      const availableSeats = totalSeats - occupiedSeats;

      return {
        ...trip,
        seatsInfo: {
          totalSeats,
          occupiedSeats,
          availableSeats
        }
      };
    });

    res.json(tripsWithSeatInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/trips/:tripId", async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { passengers: true },
    });

    if (!trip) return res.status(404).json({ error: "Trip not found" });

    res.json(trip);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rotas de passageiros
app.post("/trips/:tripId/passengers", async (req, res) => {
  try {
    const { tripId } = req.params;
    const { name, cpf, seatNumber, hasPaid } = req.body;

    const passenger = await prisma.passenger.create({
      data: {
        id: uuidv4(),
        name,
        cpf,
        seatNumber,
        hasPaid,
        tripId,
      },
    });

    res.status(201).json(passenger);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/trips/:tripId/passengers", async (req, res) => {
  try {
    const { tripId } = req.params;
    const passengers = await prisma.passenger.findMany({
      where: { tripId },
    });
    res.json(passengers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/trips/:tripId/passengers/:passengerId/payment", async (req, res) => {
  try {
    const { tripId, passengerId } = req.params;
    const { hasPaid } = req.body;

    if (typeof hasPaid !== "boolean") {
      return res.status(400).json({ error: "Invalid value for hasPaid" });
    }

    const passenger = await prisma.passenger.findUnique({
      where: { id: passengerId },
    });

    if (!passenger) {
      return res.status(404).json({ error: "Passenger not found" });
    }

    if (passenger.tripId !== tripId) {
      return res.status(400).json({ error: "Passenger does not belong to this trip" });
    }

    const updatedPassenger = await prisma.passenger.update({
      where: { id: passengerId },
      data: { hasPaid },
    });

    res.json(updatedPassenger);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/trips/:tripId/passengers/:passengerId", async (req, res) => {
  try {
    const { tripId, passengerId } = req.params;

    const passenger = await prisma.passenger.findUnique({
      where: { id: passengerId },
    });

    if (!passenger) {
      return res.status(404).json({ error: "Passenger not found" });
    }

    if (passenger.tripId !== tripId) {
      return res.status(400).json({ error: "Passenger does not belong to this trip" });
    }

    await prisma.passenger.delete({
      where: { id: passengerId },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota para gerar PDF dos passageiros
app.get("/trips/:tripId/passengers/pdf", async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { passengers: true },
    });

    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=passageiros_${tripId}.pdf`);

    doc.pipe(stream);
    stream.pipe(res);

    doc.fontSize(18).text(`Passageiros da Viagem para ${trip.destination}`, {
      align: "center",
    });
    doc.moveDown(1);

    const tableTop = doc.y;
    const colWidths = [200, 150, 80, 80];

    doc
      .fontSize(12)
      .text("Nome", 50, tableTop, { bold: true })
      .text("CPF", 250, tableTop, { bold: true })
      .text("Assento", 400, tableTop, { bold: true })
      .text("Pago", 480, tableTop, { bold: true });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    trip.passengers.forEach((passenger, index) => {
      const y = tableTop + (index + 2) * 20;

      doc
        .fontSize(10)
        .text(passenger.name, 50, y)
        .text(passenger.cpf, 250, y)
        .text(passenger.seatNumber.toString(), 400, y)
        .text(passenger.hasPaid ? "Sim" : "Não", 480, y);
    });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
