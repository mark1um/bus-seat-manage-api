/*
  Warnings:

  - Added the required column `contato` to the `Passenger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `destino` to the `Passenger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `origem` to the `Passenger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valorPago` to the `Passenger` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "contato" TEXT NOT NULL,
ADD COLUMN     "destino" TEXT NOT NULL,
ADD COLUMN     "origem" TEXT NOT NULL,
ADD COLUMN     "valorPago" DOUBLE PRECISION NOT NULL;
