<?php

namespace App\Models;

/**
 * Table: responses (via Prisma @@map)
 */
class QuestionResponse extends PrismaModel
{
    protected $table = 'responses';

    public $incrementing = false;
    protected $keyType = 'string';
    protected $primaryKey = 'response_id';
    public $timestamps = false;

    protected $fillable = [
        'response_id', 'test_id', 'respondent_id', 'question_id',
        'raw_value', 'created_at', 'updated_at',
    ];

    protected $casts = [
        'raw_value' => 'float',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'test_id', 'id');
    }

    public function question()
    {
        return $this->belongsTo(SensoryQuestion::class, 'question_id', 'question_id');
    }
}
