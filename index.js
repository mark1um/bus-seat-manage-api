const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 80;

app.use(express.json());
app.use(cors());

const prisma = new PrismaClient();

// Criar uma nova viagem
app.post("/trips", async (req, res) => {
  try {
    const { destination, departureDate, departureTime, price, busType } =
      req.body;
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

// Listar todas as viagens
app.get("/trips", async (req, res) => {
  try {
    const trips = await prisma.trip.findMany();
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar uma única viagem com passageiros
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

// Adicionar passageiro a uma viagem
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

// Listar passageiros de uma viagem
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
    const { hasPaid } = req.body; // Espera um campo "hasPaid" para atualizar

    if (typeof hasPaid !== "boolean") {
      return res.status(400).json({ error: "Invalid value for hasPaid" });
    }

    // Verificar se o passageiro realmente pertence à viagem
    const passenger = await prisma.passenger.findUnique({
      where: { id: passengerId },
    });

    if (!passenger) {
      return res.status(404).json({ error: "Passenger not found" });
    }

    if (passenger.tripId !== tripId) {
      return res
        .status(400)
        .json({ error: "Passenger does not belong to this trip" });
    }

    // Atualiza o status de pagamento do passageiro
    const updatedPassenger = await prisma.passenger.update({
      where: { id: passengerId },
      data: { hasPaid },
    });

    // Retorna o passageiro atualizado
    res.json(updatedPassenger);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PDFDocument = require("pdfkit");
const { PassThrough } = require("stream");

app.get("/trips/:tripId/passengers/pdf", async (req, res) => {
  try {
    const { tripId } = req.params;

    // Buscar viagem e passageiros
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { passengers: true },
    });

    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    // Criar um novo documento PDF
    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();

    // Configurar cabeçalhos da resposta
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=passageiros_${tripId}.pdf`
    );

    doc.pipe(stream);
    stream.pipe(res);

    // **Título da viagem**
    doc.fontSize(18).text(`Passageiros da Viagem para ${trip.destination}`, {
      align: "center",
    });
    doc.moveDown(1);

    // **Cabeçalho da tabela**
    const tableTop = doc.y;
    const colWidths = [200, 150, 80, 80]; // Largura das colunas

    doc
      .fontSize(12)
      .text("Nome", 50, tableTop, { bold: true })
      .text("CPF", 250, tableTop, { bold: true })
      .text("Assento", 400, tableTop, { bold: true })
      .text("Pago", 480, tableTop, { bold: true });

    doc.moveDown(0.5);

    // **Linha separadora**
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();

    doc.moveDown(0.5);

    // **Preencher a tabela com os passageiros**
    trip.passengers.forEach((passenger, index) => {
      const y = tableTop + (index + 2) * 20;

      doc
        .fontSize(10)
        .text(passenger.name, 50, y)
        .text(passenger.cpf, 250, y)
        .text(passenger.seatNumber.toString(), 400, y)
        .text(passenger.hasPaid ? "Sim" : "Não", 480, y);
    });

    // Finalizar o PDF
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
