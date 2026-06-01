<?php

namespace App\Models;

class StudyParticipant extends PrismaModel
{
    protected $table = 'StudyParticipant';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'panelistId', 'source', 'guestCode', 'status',
        'stratum', 'selectionOrder', 'panelistNumber', 'randomizeCode',
        'sampleCodes', 'offeredSessions', 'applicationAt', 'requestedSessionAt',
        'consentStatus', 'invitationSent', 'confirmedAt', 'consentedAt',
        'declinedAt', 'sessionAt', 'reminderSentAt', 'completedAt', 'noShow',
    ];

    protected $casts = [
        'selectionOrder' => 'integer',
        'panelistNumber' => 'integer',
        'sampleCodes' => 'json',
        'offeredSessions' => 'json',
        'noShow' => 'boolean',
        'invitationSent' => 'datetime',
        'confirmedAt' => 'datetime',
        'consentedAt' => 'datetime',
        'declinedAt' => 'datetime',
        'sessionAt' => 'datetime',
        'reminderSentAt' => 'datetime',
        'completedAt' => 'datetime',
        'applicationAt' => 'datetime',
        'requestedSessionAt' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }

    public function panelist()
    {
        return $this->belongsTo(Panelist::class, 'panelistId');
    }

    public function responses()
    {
        return $this->hasMany(SensoryResponse::class, 'participantId');
    }

    public function responseDraft()
    {
        return $this->hasOne(SensoryResponseDraft::class, 'participantId');
    }
}
