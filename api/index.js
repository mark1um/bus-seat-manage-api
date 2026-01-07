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
      }
    });

    // Adicionar informações de contagem de assentos para cada viagem
    const tripsWithSeatInfo = await Promise.all(trips.map(async trip => {
      const passengersCount = await prisma.passenger.count({
        where: { tripId: trip.id }
      });

      const totalSeats = {
        small: 20,
        medium: 30,
        large: 50
      }[trip.busType];

      return {
        id: trip.id,
        destination: trip.destination,
        departureDate: trip.departureDate,
        departureTime: trip.departureTime,
        price: trip.price,
        busType: trip.busType,
        seatsInfo: {
          totalSeats,
          occupiedSeats: passengersCount,
          availableSeats: totalSeats - passengersCount
        }
      };
    }));

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
    const { name, cpf, seatNumber, hasPaid, contato, origem, destino, valorPago } = req.body;

    const passenger = await prisma.passenger.create({
      data: {
        id: uuidv4(),
        name,
        cpf,
        seatNumber,
        hasPaid,
        contato,
        origem,
        destino,
        valorPago,
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

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = new PassThrough();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=passageiros_${tripId}.pdf`);

    doc.pipe(stream);
    stream.pipe(res);

    // Obter data formatada
    const today = new Date();
    const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    // Título principal
    doc.fontSize(14).font("Helvetica-Bold").text("meu pau " + dateStr, {
      align: "center",
    });

    // Subtítulo
    doc.fontSize(12).text(`${trip.destination.toUpperCase()}`, {
      align: "center",
      marginBottom: 20,
    });

    // Definir largura das colunas
    const startX = 40;
    const colWidths = {
      num: 30,
      nome: 100,
      contato: 90,
      origem: 80,
      documento: 95,
      pagamento: 70,
      destino: 95,
    };

    const tableTop = doc.y;
    let currentY = tableTop;

    // Desenhar cabeçalho da tabela com bordas
    const headerHeight = 25;
    
    // Linha de cima
    doc.moveTo(startX, currentY).lineTo(startX + 560, currentY).stroke();

    // Conteúdo do cabeçalho
    currentY += 5;
    doc.fontSize(10).font("Helvetica-Bold");
    
    let colX = startX + 3;
    doc.text("#", colX, currentY);
    
    colX += colWidths.num;
    doc.text("NOME", colX, currentY);
    
    colX += colWidths.nome;
    doc.text("CONTATO", colX, currentY);
    
    colX += colWidths.contato;
    doc.text("ORIGEM", colX, currentY);
    
    colX += colWidths.origem;
    doc.text("DOCUMENTO", colX, currentY);
    
    colX += colWidths.documento;
    doc.text("PAGAMENTO", colX, currentY);
    
    colX += colWidths.pagamento;
    doc.text("DESTINO", colX, currentY);

    // Linha de separação após cabeçalho
    currentY += headerHeight - 5;
    doc.moveTo(startX, currentY).lineTo(startX + 560, currentY).stroke();

    currentY += 3;

    // Desenhar linhas de passageiros
    const rowHeight = 20;
    
    trip.passengers.forEach((passenger, index) => {
      const rowNum = index + 1;
      
      // Preencher com cor amarela para linhas ímpares
      if (rowNum % 2 === 1) {
        doc.rect(startX, currentY - 2, 560, rowHeight).fill("#FFFF99").stroke();
      } else {
        doc.moveTo(startX, currentY - 2).lineTo(startX + 560, currentY - 2).stroke();
        doc.moveTo(startX, currentY + rowHeight - 2).lineTo(startX + 560, currentY + rowHeight - 2).stroke();
      }

      doc.fontSize(9).font("Helvetica").fillColor("black");

      let colX = startX + 3;
      doc.text(String(rowNum), colX, currentY);
      
      colX += colWidths.num;
      doc.text(passenger.name || "", colX, currentY, { width: colWidths.nome - 5 });
      
      colX += colWidths.nome;
      doc.text(passenger.contato || "", colX, currentY, { width: colWidths.contato - 5 });
      
      colX += colWidths.contato;
      doc.text(passenger.origem || "", colX, currentY, { width: colWidths.origem - 5 });
      
      colX += colWidths.origem;
      doc.text(passenger.cpf || "", colX, currentY, { width: colWidths.documento - 5 });
      
      colX += colWidths.documento;
      doc.text(passenger.hasPaid ? "SIM" : "NÃO", colX, currentY);
      
      colX += colWidths.pagamento;
      doc.text(passenger.destino || "", colX, currentY, { width: colWidths.destino - 5 });

      currentY += rowHeight;
    });

    // Linha de fechamento da tabela
    doc.moveTo(startX, currentY).lineTo(startX + 560, currentY).stroke();

    // Desenhar bordas verticais
    doc.moveTo(startX, tableTop).lineTo(startX, currentY).stroke();
    doc.moveTo(startX + colWidths.num, tableTop).lineTo(startX + colWidths.num, currentY).stroke();
    doc.moveTo(startX + colWidths.num + colWidths.nome, tableTop).lineTo(startX + colWidths.num + colWidths.nome, currentY).stroke();
    doc.moveTo(startX + colWidths.num + colWidths.nome + colWidths.contato, tableTop).lineTo(startX + colWidths.num + colWidths.nome + colWidths.contato, currentY).stroke();
    doc.moveTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem, tableTop).lineTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem, currentY).stroke();
    doc.moveTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem + colWidths.documento, tableTop).lineTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem + colWidths.documento, currentY).stroke();
    doc.moveTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem + colWidths.documento + colWidths.pagamento, tableTop).lineTo(startX + colWidths.num + colWidths.nome + colWidths.contato + colWidths.origem + colWidths.documento + colWidths.pagamento, currentY).stroke();
    doc.moveTo(startX + 560, tableTop).lineTo(startX + 560, currentY).stroke();

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
