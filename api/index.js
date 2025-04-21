const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
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

// Middleware de autenticação
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Token error' });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: 'Token malformatted' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token invalid' });
    }

    req.userId = decoded.id;
    return next();
  });
};

// Rotas de autenticação
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const userExists = await prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    return res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/validate", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Rotas de viagens (protegidas)
app.post("/api/trips", authMiddleware, async (req, res) => {
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

app.get("/api/trips", authMiddleware, async (req, res) => {
  try {
    const trips = await prisma.trip.findMany();
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/trips/:tripId", authMiddleware, async (req, res) => {
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

// Rotas de passageiros (protegidas)
app.post("/api/trips/:tripId/passengers", authMiddleware, async (req, res) => {
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

app.get("/api/trips/:tripId/passengers", authMiddleware, async (req, res) => {
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

app.put("/api/trips/:tripId/passengers/:passengerId/payment", authMiddleware, async (req, res) => {
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

app.delete("/api/trips/:tripId/passengers/:passengerId", authMiddleware, async (req, res) => {
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
app.get("/api/trips/:tripId/passengers/pdf", authMiddleware, async (req, res) => {
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
