import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ReceiptOcrService } from './receipt-ocr.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ReceiptOcrService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
